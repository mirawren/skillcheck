#!/usr/bin/env node
/**
 * Execute the shell in `action.yml` and assert what it passes to skillcheck.
 *
 * The Action is the adoption path — most people will never run the CLI by hand
 * — and it is the one part of this repo that CI otherwise cannot see. It can't
 * be integration-tested the obvious way either: its steps run
 * `npx skillcheck@<version>`, so a real run resolves the *published* package,
 * not the build under test.
 *
 * So this tests the part that actually breaks: the argument assembly. It parses
 * the real `action.yml`, runs each `run:` block under bash with a stub `npx` on
 * PATH, and checks the resulting argv exactly.
 *
 * It runs under /bin/bash specifically. macOS runners still ship bash 3.2,
 * where expanding an empty array under `set -u` aborts the step before
 * skillcheck starts — a failure invisible on Ubuntu, which has bash 5.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const action = YAML.parse(readFileSync(join(root, "action.yml"), "utf8"));
const setupNode = action.runs.steps.find((step) => step.name === "Set up a supported Node.js runtime");
if (setupNode?.uses !== "actions/setup-node@v6" || setupNode.with?.["node-version"] !== "20") {
  throw new Error("action.yml must provision its supported Node 20 runtime with actions/setup-node@v6");
}
const actionVersion = action.inputs.version.default;

const BASH = "/bin/bash";
const work = mkdtempSync(join(tmpdir(), "skillcheck-action-"));
const argvFile = join(work, "argv.txt");

// A stub `npx` that records argv, one argument per line, instead of running.
const binDir = join(work, "bin");
execFileSync("mkdir", ["-p", binDir]);
const stub = join(binDir, "npx");
writeFileSync(stub, `#!/bin/sh\n: > "${argvFile}"\nfor a in "$@"; do printf '%s\\n' "$a" >> "${argvFile}"; done\n`);
chmodSync(stub, 0o755);

/** The `run:` script of a step, by its `name:`. */
function stepScript(name) {
  const step = action.runs.steps.find((s) => s.name === name);
  if (!step) throw new Error(`action.yml has no step named "${name}"`);
  return step.run;
}

const BASE_ENV = {
  SKILLCHECK_VERSION: actionVersion,
  SKILLCHECK_PATH: ".",
  SKILLCHECK_FORMAT: "github",
  SKILLCHECK_CONFIG: "",
  SKILLCHECK_BASELINE: "",
  SKILLCHECK_MAX_WARNINGS: "",
  SKILLCHECK_FIX: "false",
  SKILLCHECK_SUMMARY: "true",
};

let failures = 0;

function check(label, { step, env, expect }) {
  const script = join(work, "step.sh");
  writeFileSync(script, stepScript(step));
  let argv;
  try {
    execFileSync(BASH, [script], {
      env: { ...process.env, ...BASE_ENV, ...env, PATH: `${binDir}:${process.env.PATH}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    argv = readFileSync(argvFile, "utf8").split("\n").slice(0, -1);
  } catch (err) {
    const detail = `${err.stderr ?? ""}${err.stdout ?? ""}`.trim();
    console.error(`  ✖ ${label}\n      the step exited ${err.status}: ${detail}`);
    failures++;
    return;
  }

  const got = JSON.stringify(argv);
  const want = JSON.stringify(expect);
  if (got === want) {
    console.log(`  ✔ ${label}`);
  } else {
    console.error(`  ✖ ${label}\n      expected ${want}\n      got      ${got}`);
    failures++;
  }
}

const CHECK = "Run skillcheck";
const TEST = "Run trigger scenarios";

console.log(`action.yml under ${execFileSync(BASH, ["--version"]).toString().split("\n")[0]}\n`);

// The default invocation: every optional input empty. This is the one that
// aborted on bash 3.2, and it is by far the most common real-world call.
check("check step, all optional inputs empty", {
  step: CHECK,
  env: {},
  expect: ["--yes", `skillcheck@${actionVersion}`, ".", "--format", "github", "--summary"],
});

check("test step, all optional inputs empty", {
  step: TEST,
  env: {},
  expect: ["--yes", `skillcheck@${actionVersion}`, "test", "."],
});

// Every optional input set, including a path containing a space — the case a
// naive string-concatenation fix would split into two broken arguments.
check("check step, every optional input set", {
  step: CHECK,
  env: {
    SKILLCHECK_MAX_WARNINGS: "0",
    SKILLCHECK_CONFIG: "my dir/skillcheck.config.json",
    SKILLCHECK_BASELINE: "my dir/baseline.json",
    SKILLCHECK_FIX: "true",
  },
  expect: [
    "--yes",
    `skillcheck@${actionVersion}`,
    ".",
    "--format",
    "github",
    "--max-warnings",
    "0",
    "--config",
    "my dir/skillcheck.config.json",
    "--baseline",
    "my dir/baseline.json",
    "--fix",
    "--summary",
  ],
});

// `config` scopes which skills exist, so the scenarios have to see the same set
// the lint step did.
check("test step forwards config", {
  step: TEST,
  env: { SKILLCHECK_CONFIG: "my dir/skillcheck.config.json" },
  expect: ["--yes", `skillcheck@${actionVersion}`, "test", ".", "--config", "my dir/skillcheck.config.json"],
});

// `path` is documented as accepting several space-separated paths.
check("check step splits a multi-path input", {
  step: CHECK,
  env: { SKILLCHECK_PATH: "skills plugins", SKILLCHECK_SUMMARY: "false" },
  expect: ["--yes", `skillcheck@${actionVersion}`, "skills", "plugins", "--format", "github"],
});

// summary: false must drop the flag, not pass an empty argument.
check("check step omits --summary when disabled", {
  step: CHECK,
  env: { SKILLCHECK_SUMMARY: "false" },
  expect: ["--yes", `skillcheck@${actionVersion}`, ".", "--format", "github"],
});

rmSync(work, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} action.yml check(s) failed`);
  process.exit(1);
}
console.log("\naction.yml passes every argument correctly");

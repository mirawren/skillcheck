#!/usr/bin/env node
/**
 * Verify that the terminal output shown in the docs is the output the tool
 * actually produces.
 *
 * A README is a promise, and the numbers in one drift silently. This project's
 * shipped README claimed `53% / 47% / by only 12%` for a `why` invocation whose
 * real answer was `54% / 46% / by only 14%` — nobody had run it since the
 * ranking last changed. It reads as a fabricated screenshot, which is the
 * cheapest possible way to lose an argument about a measurement tool.
 *
 * So the interesting examples are marked in the markdown and re-run here:
 *
 *     <!-- verify: why "review my code changes before I commit" . cwd=tests/fixtures/bad -->
 *     ```console
 *     $ npx skillcheck why "review my code changes before I commit"
 *     ...expected output...
 *     ```
 *
 * The comment names the real argv and the directory to run it in; the fenced
 * block that follows is the expectation. The `$ ...` line is documentation — it
 * can read however is clearest for a person — and everything after it must match
 * what the CLI printed, ignoring colour and trailing whitespace.
 *
 * `--check` (the default) fails on any difference. `--update` rewrites the
 * blocks in place, so keeping the docs honest is one command rather than a
 * transcription exercise.
 *
 * Run after `npm run build` — it drives dist/, the code that actually ships.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const update = process.argv.includes("--update");

/** Docs whose fenced console blocks may carry a `verify:` marker. */
const DOCS = ["README.md", "docs/trigger-simulation.md", "docs/scenarios.md", "docs/languages.md"];

const MARKER = /^<!--\s*verify:\s*(.+?)\s*-->$/;

function readText(path) {
  return readFileSync(path, "utf8").replace(/\r\n?/g, "\n");
}

/**
 * Split a marker into argv plus options, honoring quoted arguments — a request
 * is one argument containing spaces, which is the whole point of the examples.
 */
function parseMarker(spec) {
  const tokens = spec.match(/"[^"]*"|\S+/g) ?? [];
  const argv = [];
  const options = { cwd: ".", exit: null, head: null };
  for (const token of tokens) {
    const option = /^(cwd|exit|head)=(.*)$/.exec(token);
    if (option) {
      options[option[1]] = option[2];
      continue;
    }
    argv.push(token.startsWith('"') ? token.slice(1, -1) : token);
  }
  return { argv, options };
}

/** The elision line a truncated example ends with, so the cut is visible. */
const ELLIPSIS = "…";

/** Run the built CLI in-process and capture everything it wrote. */
async function run(argv, cwd) {
  const { runCli } = await import(new URL("../dist/cli.js", import.meta.url));
  const chunks = [];
  const io = {
    out: (text) => chunks.push(text),
    err: (text) => chunks.push(text),
    // No GITHUB_* variables: an example must render the same on a laptop as in CI.
    env: {},
  };
  const previous = process.cwd();
  process.chdir(join(root, cwd));
  try {
    const code = runCli(argv, io);
    return { code, text: stripVTControlCharacters(chunks.join("")) };
  } finally {
    process.chdir(previous);
  }
}

function normalize(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

const failures = [];
let verified = 0;
let rewritten = 0;

for (const doc of DOCS) {
  const path = join(root, doc);
  let lines;
  try {
    lines = readText(path).split("\n");
  } catch {
    continue; // an optional doc that doesn't exist yet
  }

  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const marker = MARKER.exec(lines[i].trim());
    if (!marker) continue;

    // The fence must open on the next non-blank line.
    let open = i + 1;
    while (open < lines.length && lines[open].trim() === "") open++;
    if (!/^```/.test(lines[open] ?? "")) {
      failures.push(`${doc}:${i + 1} verify marker is not followed by a fenced block`);
      continue;
    }
    let close = open + 1;
    while (close < lines.length && !/^```\s*$/.test(lines[close])) close++;
    if (close >= lines.length) {
      failures.push(`${doc}:${open + 1} fenced block is never closed`);
      continue;
    }

    const { argv, options } = parseMarker(marker[1]);
    const { code, text } = await run(argv, options.cwd);
    verified++;

    if (options.exit !== null && String(code) !== options.exit) {
      failures.push(
        `${doc}:${open + 1} exited ${code}, the marker declares exit=${options.exit}` +
          `\n    ran: skillcheck ${argv.join(" ")} (in ${options.cwd})`,
      );
    }

    const body = lines.slice(open + 1, close);
    // Keep the leading `$ …` invocation line and any blank line after it: it is
    // written for a reader, not for the shell.
    const prologue = [];
    let at = 0;
    if (body[0]?.startsWith("$ ")) {
      prologue.push(body[0]);
      at = 1;
      if (body[1] === "") {
        prologue.push("");
        at = 2;
      }
    }

    /**
     * `head=N` verifies only the first N lines.
     *
     * Some commands end with output that is correct and useless to a reader —
     * `languages` prints the whole 24-entry registry, which would bury the three
     * lines the section is about. Truncating keeps the block short *and* checked,
     * instead of the usual alternative: an unverified block that quietly drifts.
     */
    const head = options.head === null ? null : Number(options.head);
    let expectedText = normalize(text);
    if (head !== null) {
      expectedText = normalize(
        [...expectedText.split("\n").slice(0, head), ELLIPSIS].join("\n"),
      );
    }

    const documented = normalize(body.slice(at).join("\n"));
    if (documented === expectedText) continue;

    if (update) {
      lines.splice(open + 1, close - (open + 1), ...prologue, ...expectedText.split("\n"));
      changed = true;
      rewritten++;
      continue;
    }

    failures.push(
      `${doc}:${open + 1} documented output does not match what the tool prints` +
        `\n    ran: skillcheck ${argv.join(" ")} (in ${options.cwd})` +
        `\n${diff(documented, expectedText)}`,
    );
  }

  if (changed) writeFileSync(path, lines.join("\n"));
}

function diff(expected, actual) {
  const a = expected.split("\n");
  const b = actual.split("\n");
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push(`    - ${a[i]}`);
    if (b[i] !== undefined) out.push(`    + ${b[i]}`);
  }
  return out.slice(0, 20).join("\n");
}

if (update && failures.length === 0) {
  console.log(`checked ${verified} documented example(s); rewrote ${rewritten}`);
} else if (failures.length > 0) {
  // Structural problems — an unclosed fence, a marker with no block — are not
  // fixable by rewriting, so --update must not report success while holding one.
  console.error(`${failures.length} documented example(s) do not match the tool:\n`);
  for (const failure of failures) console.error(`  ✖ ${failure}\n`);
  console.error("Run `npm run docs:examples` to rewrite them from real output.");
  process.exit(1);
} else {
  console.log(`✔ ${verified} documented example(s) match the tool's real output`);
}

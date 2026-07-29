import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { REPO_URL } from "./meta.js";
import { parseScenarios, SCENARIO_FILENAMES, type ScenarioSeed, scenarioTemplate } from "./scenarios.js";

/**
 * `skillcheck init` is meant to be run more than once.
 *
 * The first run scaffolds; later runs are how you pick up a skill you added
 * last week. That makes "don't destroy what's already there" the governing
 * constraint — a scenarios file is hand-written trigger tests, the single most
 * expensive artifact in an adopting repo, and a scaffolder that eats them once
 * is a scaffolder nobody runs twice.
 */

export interface InitOptions {
  /** Directory to scaffold into (default: cwd). */
  dir?: string;
  /** Overwrite existing files. */
  force?: boolean;
  /** skillcheck version to pin the devDependency to (e.g. "0.3.0"). */
  version?: string;
  /** Skills discovered in the target dir — seeds the starter trigger tests. */
  skills?: readonly ScenarioSeed[];
}

export interface InitResult {
  created: string[];
  /** Files that existed and were added to, rather than replaced. */
  updated: string[];
  skipped: string[];
  notes: string[];
}

/**
 * How many skills a *fresh* scenarios file is seeded with.
 *
 * Enough to show the shape; not so many that a 40-skill repo opens a wall of
 * tautological prompts nobody reads. Skills past the cap get picked up on a
 * later run, one at a time, as they stop being covered.
 */
const SEED_LIMIT = 3;

const WORKFLOW_REL = join(".github", "workflows", "skillcheck.yml");

/** The CI workflow scaffolded into an adopter's repo. */
function workflowYaml(): string {
  return `# Added by \`skillcheck init\` — lints your agent skills (SKILL.md) and
# Claude Code plugins on every pull request. Docs: ${REPO_URL}
name: skillcheck
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  skillcheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx --yes skillcheck@latest . --format github
      # Trigger tests: assert each request still reaches the skill you meant.
      # Delete this step if you don't keep a scenarios file.
      - run: npx --yes skillcheck@latest test
        if: hashFiles('skillcheck.scenarios.yaml', 'skillcheck.scenarios.yml') != ''
`;
}

/**
 * Scaffold skillcheck into a repo: write the CI workflow and, for Node
 * projects, add skillcheck to devDependencies. Both are what GitHub's
 * dependency graph counts as "dependents", so one command plants both signals.
 * Never overwrites without `force`.
 */
export function runInit(opts: InitOptions = {}): InitResult {
  const root = resolve(opts.dir ?? process.cwd());
  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];
  const notes: string[] = [];
  const seeds = opts.skills ?? [];

  // 1. CI workflow. Ours to regenerate, so an existing one is only interesting
  //    when it differs from what this version would write.
  const workflowPath = join(root, WORKFLOW_REL);
  const desiredWorkflow = workflowYaml();
  if (existsSync(workflowPath) && !opts.force) {
    skipped.push(
      readFileOrNull(workflowPath) === desiredWorkflow
        ? `${WORKFLOW_REL} (already up to date)`
        : `${WORKFLOW_REL} (already exists and differs — pass --force to overwrite)`,
    );
  } else {
    mkdirSync(dirname(workflowPath), { recursive: true });
    writeFileSync(workflowPath, desiredWorkflow);
    created.push(WORKFLOW_REL);
  }

  // 2. Trigger tests. A fresh file gets the seeded template; an existing one
  //    gets scenarios for skills it doesn't mention yet, and keeps everything
  //    it already had.
  const existingScenarios = SCENARIO_FILENAMES.map((n) => join(root, n)).find((p) => existsSync(p));
  if (existingScenarios && !opts.force) {
    const outcome = appendMissingScenarios(existingScenarios, seeds);
    const rel = existingScenarios.slice(root.length + 1);
    if ("error" in outcome) {
      skipped.push(`${rel} (left alone — ${outcome.error})`);
    } else if (outcome.added.length === 0) {
      skipped.push(`${rel} (every skill already has a scenario)`);
    } else {
      updated.push(`${rel} (added ${outcome.added.length}: ${outcome.added.join(", ")})`);
      notes.push("Replace the appended prompts with the words a user would actually type.");
    }
  } else {
    const scenarioPath = join(root, SCENARIO_FILENAMES[0]);
    writeFileSync(scenarioPath, scenarioTemplate(seeds.slice(0, SEED_LIMIT)));
    created.push(SCENARIO_FILENAMES[0]);
    notes.push(
      seeds.length
        ? "Edit the scenarios file with real requests, then run `skillcheck test`."
        : "No skills found here yet — fill in the scenarios file once you add some.",
    );
  }

  // 3. devDependency (Node projects only — many skill repos aren't).
  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    const outcome = addDevDependency(pkgPath, opts.version);
    if (outcome === "added") {
      created.push("package.json (added skillcheck to devDependencies)");
      notes.push("Run `npm install` to update your lockfile.");
    } else if (outcome === "present") {
      skipped.push("package.json (skillcheck already a devDependency)");
    } else {
      notes.push("package.json couldn't be updated — add skillcheck to devDependencies manually.");
    }
  } else {
    notes.push("No package.json here — for a Node project, also run `npm install --save-dev skillcheck`.");
  }

  // 4. Badge + next steps.
  notes.push(
    "Add your live score badge to README (replace USER/REPO):\n" +
      `  [![skillcheck](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/USER/REPO/main/.github/badges/skillcheck.json)](${REPO_URL})\n` +
      "  Generate the JSON in CI with:  skillcheck . --format badge > .github/badges/skillcheck.json",
  );

  return { created, updated, skipped, notes };
}

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Add starter scenarios for skills the file doesn't mention, in place.
 *
 * "Mention" spans `expect` *and* `forbid`: a skill you've deliberately written
 * a `forbid` for is covered — appending an `expect` for it would contradict the
 * assertion its author just made.
 *
 * The write is guarded by a re-parse. Appending assumes the `scenarios:` list
 * runs to the end of the file, which is true of what we generate but not of
 * every file someone might hand-write. When that assumption doesn't hold the
 * append is abandoned rather than committed: declining to help costs a line of
 * output, and silently corrupting a repo's trigger tests costs its trust.
 */
function appendMissingScenarios(
  path: string,
  seeds: readonly ScenarioSeed[],
): { added: string[] } | { error: string } {
  const before = readFileOrNull(path);
  if (before === null) return { error: "could not read it" };

  let existing: ReturnType<typeof parseScenarios>;
  try {
    existing = parseScenarios(before, path);
  } catch {
    return { error: "it doesn't parse; fix it and re-run" };
  }

  const covered = new Set(existing.flatMap((s) => [...s.expect, ...s.forbid]));
  const missing = seeds.filter((seed) => !covered.has(seed.name));
  if (missing.length === 0) return { added: [] };

  const block = missing
    .map((seed) => `\n  - prompt: ${JSON.stringify(seed.prompt)}\n    expect: ${seed.name}\n`)
    .join("");
  const after = `${before.endsWith("\n") ? before : `${before}\n`}${block}`;

  try {
    const reparsed = parseScenarios(after, path);
    if (reparsed.length !== existing.length + missing.length) {
      return { error: "appending would have altered the scenarios already there" };
    }
  } catch {
    return { error: "appending would have made it invalid YAML" };
  }

  writeFileSync(path, after);
  return { added: missing.map((seed) => seed.name) };
}

function addDevDependency(pkgPath: string, version?: string): "added" | "present" | "error" {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  } catch {
    return "error";
  }
  if (pkg === null || typeof pkg !== "object" || Array.isArray(pkg)) return "error";

  const dev = (pkg.devDependencies ?? {}) as Record<string, unknown>;
  if (typeof dev.skillcheck === "string") return "present";
  // Also treat a runtime dependency as "present" — don't duplicate.
  const runtime = (pkg.dependencies ?? {}) as Record<string, unknown>;
  if (typeof runtime.skillcheck === "string") return "present";

  dev.skillcheck = version ? `^${version}` : "latest";
  pkg.devDependencies = sortKeys(dev);
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return "added";
}

function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

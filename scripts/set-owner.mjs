#!/usr/bin/env node
/**
 * Point the project at a real GitHub owner.
 *
 *   node scripts/set-owner.mjs my-org     # rewrite every placeholder
 *   node scripts/set-owner.mjs --check    # fail if any placeholder remains
 *
 * The repo is authored with `OWNER` as a stand-in so it can be developed and
 * reviewed before the account is chosen. That stand-in appears in badges, in
 * the Action usage snippet, in the security contact, and in package.json —
 * scattered enough that a manual find-and-replace misses one and ships a
 * package linking to a 404.
 *
 * So: one command rewrites all of them, `--check` proves none survived, and the
 * release workflow runs `--check` before it publishes. Two files mention the
 * placeholder *on purpose* (this script's own docs, and the constant that
 * defines it) and are excluded by name.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Where the placeholder is a legitimate literal, not a value to substitute. */
const EXCLUDED = new Set([
  "src/meta.ts", // defines OWNER_PLACEHOLDER
  "scripts/set-owner.mjs", // this file
  ".github/workflows/release.yml", // greps for the placeholder as a guard
]);

/**
 * Directories where the placeholder is always data, never a link to rewrite.
 *
 * Tests assert *on* the placeholder — that `isPlaceholderOwner` recognizes it,
 * that a bad `repository` field falls back to it. Rewriting those strings turns
 * each assertion into its own opposite, and because `prepublishOnly` runs the
 * suite, the failure lands on the one day it is most expensive: mid-publish,
 * after the owner has already been substituted.
 */
const EXCLUDED_DIRS = ["tests/"];

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);
const TEXT_EXT = /\.(md|json|ya?ml|ts|mjs|js)$/;

/**
 * The substitutions. Anchored to `<owner>/skillcheck` so a bare word "OWNER"
 * in prose is never touched — only the places that form a real URL or a real
 * `uses:` reference.
 */
const REWRITES = [
  { from: /github\.com\/OWNER\/skillcheck/g, to: (owner) => `github.com/${owner}/skillcheck` },
  { from: /uses:\s*OWNER\/skillcheck/g, to: (owner) => `uses: ${owner}/skillcheck` },
];

/** GitHub's own rule: alphanumerics and single hyphens, max 39 chars. */
const VALID_OWNER = /^[a-zA-Z\d](?:[a-zA-Z\d]|-(?=[a-zA-Z\d])){0,38}$/;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(join(dir, entry.name));
    } else if (TEXT_EXT.test(entry.name)) {
      yield join(dir, entry.name);
    }
  }
}

/**
 * The files git would publish, when we're in a git repo — so private,
 * gitignored working notes are never rewritten and never fail the check.
 *
 * `--cached --others --exclude-standard` rather than a bare `ls-files`, because
 * a bare one lists only *tracked* files and a repo that has never been
 * committed to has none. That is precisely the state a repo is in when someone
 * clones this and runs `set-owner` for the first time, and the failure was
 * silent in both directions: nothing to rewrite, and `--check` passing because
 * it had inspected no files at all. Adding `--others` covers the
 * not-yet-committed case while `--exclude-standard` keeps .gitignore honored.
 *
 * Falls back to a directory walk when git isn't there at all (a published
 * tarball has no .git).
 */
function trackedFiles() {
  try {
    const files = execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { cwd: root, encoding: "utf8" },
    )
      .split("\0")
      .filter((rel) => rel && TEXT_EXT.test(rel))
      .map((rel) => join(root, rel))
      .filter((file) => existsSync(file));
    // An empty result means git ran but knows nothing about this tree; walking
    // is a better answer than silently declaring the repo clean.
    return files.length > 0 ? files : [...walk(root)];
  } catch {
    return [...walk(root)];
  }
}

function candidates() {
  const out = [];
  for (const file of trackedFiles()) {
    const rel = relative(root, file).split("\\").join("/");
    if (EXCLUDED.has(rel)) continue;
    if (EXCLUDED_DIRS.some((dir) => rel.startsWith(dir))) continue;
    if (statSync(file).size > 2_000_000) continue;
    out.push({ file, rel });
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

const arg = process.argv[2];

if (!arg || arg === "--help" || arg === "-h") {
  console.log("usage: node scripts/set-owner.mjs <github-owner>\n       node scripts/set-owner.mjs --check");
  process.exit(arg ? 0 : 2);
}

// ── --check ────────────────────────────────────────────────────────────────
if (arg === "--check") {
  const offenders = [];
  for (const { file, rel } of candidates()) {
    const text = readFileSync(file, "utf8");
    text.split("\n").forEach((line, i) => {
      if (REWRITES.some((r) => new RegExp(r.from.source).test(line))) {
        offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  if (offenders.length > 0) {
    console.error(`The OWNER placeholder is still present in ${offenders.length} place(s):\n`);
    for (const line of offenders) console.error(`  ${line}`);
    console.error("\nRun: npm run set-owner <your-github-owner>");
    process.exit(1);
  }
  console.log("no OWNER placeholders remain");
  process.exit(0);
}

// ── rewrite ────────────────────────────────────────────────────────────────
const owner = arg;
if (!VALID_OWNER.test(owner)) {
  console.error(`"${owner}" is not a valid GitHub owner (letters, digits and single hyphens, max 39 chars)`);
  process.exit(2);
}

let changedFiles = 0;
let changedSites = 0;
for (const { file, rel } of candidates()) {
  const before = readFileSync(file, "utf8");
  let after = before;
  let sites = 0;
  for (const rule of REWRITES) {
    after = after.replace(rule.from, () => {
      sites++;
      return rule.to(owner);
    });
  }
  if (after !== before) {
    writeFileSync(file, after);
    changedFiles++;
    changedSites += sites;
    console.log(`  ${rel} (${sites})`);
  }
}

if (changedFiles === 0) {
  console.log("nothing to rewrite — no OWNER placeholders found");
} else {
  console.log(`\nrewrote ${changedSites} reference(s) across ${changedFiles} file(s) → ${owner}`);
  console.log("Review with `git diff`, then rebuild: npm run build");
}

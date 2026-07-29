import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Canonical project URLs, in one place.
 *
 * These end up in SARIF (`informationUri`, per-rule `helpUri`), in the workflow
 * `skillcheck init` scaffolds, and in every "full reference" link the CLI
 * prints. Getting them wrong means shipping a package whose findings link
 * somewhere that isn't this project.
 *
 * So they are *derived* from `package.json` rather than written down twice: the
 * `repository` field is the single source of truth, and a published tarball
 * cannot disagree with itself. The prose occurrences that can't read JSON —
 * README badges, SECURITY.md — are rewritten by `npm run set-owner`, and
 * `npm run check:owner` fails the release while any placeholder remains.
 */

/** Owner segment used until the project is published under a real account. */
export const OWNER_PLACEHOLDER = "OWNER";

const FALLBACK_REPO_URL = `https://github.com/${OWNER_PLACEHOLDER}/skillcheck`;

/**
 * Normalize any of npm's accepted `repository` spellings into a browsable
 * https URL. Anything that doesn't end up as http(s) — a shorthand like
 * `github:o/r`, a local path, junk — falls back to the placeholder rather than
 * emitting a link that 404s from a CI annotation.
 */
export function normalizeRepoUrl(raw: string | undefined): string {
  if (!raw) return FALLBACK_REPO_URL;
  const url = raw
    .trim()
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  return /^https?:\/\/\S+$/.test(url) ? url : FALLBACK_REPO_URL;
}

/**
 * `repository.url` from the package we were installed as. Never throws: a
 * missing or malformed package.json degrades to the placeholder rather than
 * taking the CLI down over a cosmetic link.
 */
function readRepoUrl(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      repository?: string | { url?: string };
    };
    return normalizeRepoUrl(typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url);
  } catch {
    return FALLBACK_REPO_URL;
  }
}

export const REPO_URL = readRepoUrl();

/** True while the project still points at the placeholder owner. */
export function isPlaceholderOwner(url: string = REPO_URL): boolean {
  return url.includes(`/${OWNER_PLACEHOLDER}/`);
}

/** Generated rule reference; each rule id is an anchor. */
export const RULES_DOC_URL = `${REPO_URL}/blob/main/docs/rules.md`;

export function ruleDocUrl(ruleId: string): string {
  return `${RULES_DOC_URL}#${ruleId}`;
}

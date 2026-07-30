import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Directory names the walk never enters. Exported because a second reader of the
 * same repo has to agree with it — see {@link isDiscoverableSkillPath}.
 */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  "vendor",
]);

/** The exact basename the walk looks for. */
export const SKILL_FILENAME = "SKILL.md";

/**
 * Whether the walk would have discovered `posixPath` (repo-relative, `/`
 * separated).
 *
 * This exists because `skillcheck diff` reads the other side of the comparison
 * out of git rather than off the disk, and the two readers must agree about what
 * a skill *is*. They didn't: git's listing matched any path merely *ending* in
 * `SKILL.md` and entered every directory, so on a completely clean working tree
 * a repo with a committed `vendor/…/SKILL.md` and a `docs/EXAMPLE-SKILL.md`
 * reported "3 skills there · 1 here · 2 removed" and five findings "fixed" — a
 * diff against no change at all. Worse, the phantoms only ever landed on the
 * historical side, so they shifted that index's idf and could flip a real
 * ranking.
 *
 * Note this is the rule for a *walked* path. A root passed explicitly on the
 * command line is still accepted by suffix (see {@link discover}), because
 * naming a file outright is an instruction, not a search.
 */
export function isDiscoverableSkillPath(posixPath: string): boolean {
  const parts = posixPath.split("/");
  if (parts[parts.length - 1] !== SKILL_FILENAME) return false;
  return !parts.slice(0, -1).some((part) => SKIP_DIRS.has(part));
}

export interface Discovered {
  skillFiles: string[];
  pluginManifests: string[];
}

/**
 * Walk the given roots and collect every SKILL.md and .claude-plugin/plugin.json.
 * A root that is itself a SKILL.md file is accepted directly.
 */
export function discover(roots: string[]): Discovered {
  const skillFiles = new Set<string>();
  const pluginManifests = new Set<string>();

  for (const root of roots) {
    const abs = resolve(root);
    const stat = statSync(abs);
    if (stat.isFile()) {
      if (abs.endsWith("SKILL.md")) skillFiles.add(abs);
      if (abs.endsWith("plugin.json")) pluginManifests.add(abs);
      continue;
    }
    walk(abs, skillFiles, pluginManifests, 0);
  }

  return {
    skillFiles: [...skillFiles].sort(),
    pluginManifests: [...pluginManifests].sort(),
  };
}

function walk(
  dir: string,
  skillFiles: Set<string>,
  pluginManifests: Set<string>,
  depth: number,
): void {
  if (depth > 12) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), skillFiles, pluginManifests, depth + 1);
    } else if (entry.name === SKILL_FILENAME) {
      skillFiles.add(join(dir, entry.name));
    } else if (entry.name === "plugin.json" && dir.endsWith(".claude-plugin")) {
      pluginManifests.add(join(dir, entry.name));
    }
  }
}

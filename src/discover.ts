import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  "vendor",
]);

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
    } else if (entry.name === "SKILL.md") {
      skillFiles.add(join(dir, entry.name));
    } else if (entry.name === "plugin.json" && dir.endsWith(".claude-plugin")) {
      pluginManifests.add(join(dir, entry.name));
    }
  }
}

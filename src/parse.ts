import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import YAML from "yaml";
import type { PluginManifest, SkillDoc } from "./types.js";

const FENCE = /^---\s*$/;

/** Read and parse a SKILL.md from disk. */
export function parseSkill(file: string): SkillDoc {
  return parseSkillText(file, readFileSync(file, "utf8"));
}

/**
 * Parse SKILL.md from already-in-memory text. The fix engine re-parses edited
 * text between passes without touching disk, so the parser must be pure over
 * `raw`.
 */
export function parseSkillText(file: string, raw: string): SkillDoc {
  const lines = raw.split(/\r?\n/);

  const doc: SkillDoc = {
    dir: dirname(file),
    file,
    raw,
    frontmatter: null,
    body: raw,
    bodyStartLine: 1,
    bodyStartOffset: 0,
  };

  if (!FENCE.test(lines[0] ?? "")) {
    doc.parseError = "file does not start with a `---` frontmatter fence";
    return doc;
  }

  const closing = lines.findIndex((l, i) => i > 0 && FENCE.test(l));
  if (closing === -1) {
    doc.parseError = "frontmatter fence `---` is never closed";
    return doc;
  }

  const fmText = lines.slice(1, closing).join("\n");
  doc.body = lines.slice(closing + 1).join("\n");
  doc.bodyStartLine = closing + 2;
  // Character offset where the body starts: length of every line up to and
  // including the closing fence, plus their newline separators. We can't just
  // sum lengths (the original newline style may be \r\n), so locate the body
  // by counting characters through the closing-fence line.
  doc.bodyStartOffset = offsetOfLine(raw, closing + 1);

  try {
    const parsed = YAML.parse(fmText);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      doc.parseError = "frontmatter is not a YAML mapping";
      return doc;
    }
    doc.frontmatter = parsed as Record<string, unknown>;
    if (typeof doc.frontmatter.name === "string") doc.name = doc.frontmatter.name;
    if (typeof doc.frontmatter.description === "string") {
      doc.description = doc.frontmatter.description;
    }
  } catch (err) {
    doc.parseError = `frontmatter is not valid YAML: ${(err as Error).message}`;
  }
  return doc;
}

export function parsePluginManifest(file: string): PluginManifest {
  const manifest: PluginManifest = { file, json: null };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      manifest.parseError = "plugin.json is not a JSON object";
      return manifest;
    }
    manifest.json = parsed as Record<string, unknown>;
  } catch (err) {
    manifest.parseError = `plugin.json is not valid JSON: ${(err as Error).message}`;
  }
  return manifest;
}

/** Directory name a skill's `name` field is expected to match. */
export function skillDirName(doc: SkillDoc): string {
  return basename(doc.dir);
}

/**
 * Character offset in `raw` where 0-indexed line `target` begins, tolerant of
 * `\n` and `\r\n`. Returns `raw.length` when `target` is past the last line.
 */
export function offsetOfLine(raw: string, target: number): number {
  if (target <= 0) return 0;
  let line = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "\n") {
      if (++line === target) return i + 1;
    }
  }
  return raw.length;
}

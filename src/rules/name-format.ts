import { frontmatterField } from "../frontmatter.js";
import { skillDirName } from "../parse.js";
import type { Rule, TextEdit } from "../types.js";

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Normalize an arbitrary name to a spec-valid kebab slug (safe, deterministic). */
export function normalizeName(name: string): string {
  const kebab = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return kebab.slice(0, 64).replace(/-+$/g, "");
}

export const nameFormat: Rule = {
  id: "name-format",
  summary:
    "`name` is lowercase kebab-case, ≤64 chars, and matches the skill's folder name",
  docs: {
    why: "The spec constrains `name` to lowercase letters, digits and single hyphens, up to 64 characters. Hosts that validate reject anything else outright; hosts that don't may resolve the skill by folder name instead, so a `name` that disagrees with its directory loads under a name you didn't choose.",
    bad: `# skills/pdf-tools/SKILL.md
name: PDF_Tools`,
    good: `# skills/pdf-tools/SKILL.md
name: pdf-tools`,
  },
  fixable: true,
  check(doc) {
    if (!doc.name) return [];
    const findings = [];
    if (doc.name.length > 64) {
      findings.push({
        ruleId: this.id,
        severity: "error" as const,
        message: `\`name\` is ${doc.name.length} chars (spec maximum is 64)`,
        file: doc.file,
        line: 1,
      });
    }
    if (!NAME_RE.test(doc.name)) {
      findings.push({
        ruleId: this.id,
        severity: "error" as const,
        message: `\`name: ${doc.name}\` is not valid — use lowercase letters, digits and single hyphens (no leading/trailing or doubled hyphens)`,
        file: doc.file,
        line: 1,
        detail: "Hosts that follow the agentskills.io spec reject or silently skip invalid names. Run `skillcheck --fix` to normalize it.",
      });
    }
    const dirName = skillDirName(doc);
    if (NAME_RE.test(doc.name) && dirName !== doc.name) {
      findings.push({
        ruleId: this.id,
        severity: "warning" as const,
        message: `\`name: ${doc.name}\` does not match its folder \`${dirName}/\``,
        file: doc.file,
        line: 1,
        detail:
          "The agentskills.io spec expects the folder to be named after the skill, and some hosts resolve skills by folder name. (Claude Code treats `name` as a display label, so this is a warning, not an error.)",
      });
    }
    return findings;
  },
  /**
   * Safe fix: rewrite an invalid `name` value to its kebab-case normalization.
   * We deliberately do NOT auto-rename to match the folder — that changes the
   * skill's identity and is a judgment call for the author.
   */
  fix(doc): TextEdit[] {
    if (!doc.name) return [];
    const normalized = normalizeName(doc.name);
    if (!normalized || normalized === doc.name) return [];
    const loc = frontmatterField(doc.raw, "name");
    // Skip anything with an inline comment we might clobber.
    if (!loc || loc.value.includes("#") || loc.valueEnd <= loc.valueStart) return [];
    return [{ start: loc.valueStart, end: loc.valueEnd, text: normalized }];
  },
};

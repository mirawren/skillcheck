import type { Rule } from "../types.js";

/** Spec: https://agentskills.io — `name` and `description` are the only required keys. */
export const frontmatterValid: Rule = {
  id: "frontmatter-valid",
  summary: "SKILL.md has parseable YAML frontmatter with `name` and `description`",
  docs: {
    why: "Frontmatter is how a host discovers a skill at all. If the fences are missing, the YAML doesn't parse, or `name`/`description` are absent, every host silently skips the file — no error, no warning, the skill simply never exists.",
    bad: `---
name: pdf-report
descripton: Generates PDF reports.
---`,
    good: `---
name: pdf-report
description: Generates polished PDF reports from markdown. Use when the user asks to export results as a PDF.
---`,
  },
  check(doc) {
    if (doc.parseError) {
      return [
        {
          ruleId: this.id,
          severity: "error",
          message: doc.parseError,
          file: doc.file,
          line: 1,
          detail:
            "Without valid frontmatter no host tool (Claude Code, Codex, Cursor, …) will load this skill at all.",
        },
      ];
    }
    const findings = [];
    if (!doc.name) {
      findings.push({
        ruleId: this.id,
        severity: "error" as const,
        message: "frontmatter is missing the required `name` field",
        file: doc.file,
        line: 1,
      });
    }
    if (!doc.description) {
      findings.push({
        ruleId: this.id,
        severity: "error" as const,
        message: "frontmatter is missing the required `description` field",
        file: doc.file,
        line: 1,
        detail:
          "The description is the ONLY text the model sees before deciding to load a skill. No description = the skill can never trigger.",
      });
    }
    return findings;
  },
};

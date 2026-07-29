import type { Finding, Rule } from "../types.js";

/**
 * Unfinished placeholder content shipped in a SKILL.md body. The body is the
 * instruction set the model follows once the skill loads, so a stray `TODO`,
 * `FIXME`, or `lorem ipsum` is either a note the model may act on literally or
 * a sign the skill was published half-written. Kept tight (uppercase markers /
 * obvious templating) to avoid flagging ordinary prose.
 */
const PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b(TODO|FIXME|XXX|HACK)\b/, label: "a TODO/FIXME marker" },
  { re: /lorem ipsum/i, label: "lorem ipsum placeholder text" },
  { re: /\bREPLACE_ME\b/i, label: "a REPLACE_ME placeholder" },
  { re: /<(?:placeholder|your-[a-z0-9-]+|todo|tbd)>/i, label: "a <placeholder> token" },
];

const MAX_FINDINGS = 10;

export const noPlaceholders: Rule = {
  id: "no-placeholders",
  summary: "body ships no TODO/FIXME/placeholder leftovers",
  docs: {
    why: "The model reads the body as instructions, not as source code it should skim past. A leftover `TODO` or `<your-api-key>` is either followed literally or treated as a gap to improvise around, and both fail in front of a user.",
    bad: "Authenticate with <your-api-key>.\n\nTODO: document the retry behaviour",
    good: "Authenticate with the key in the `REPORT_API_KEY` environment variable. Retry twice on a 5xx, then report the failure.",
  },
  check(doc): Finding[] {
    const findings: Finding[] = [];
    const lines = doc.body.split(/\r?\n/);
    for (let i = 0; i < lines.length && findings.length < MAX_FINDINGS; i++) {
      const match = PATTERNS.find((p) => p.re.test(lines[i]));
      if (!match) continue;
      findings.push({
        ruleId: this.id,
        severity: "warning",
        message: `body contains ${match.label} — leftover placeholder content`,
        file: doc.file,
        line: doc.bodyStartLine + i,
        detail:
          "The model reads the whole body when the skill fires; unfinished markers get followed or confuse it. Remove them before shipping.",
      });
    }
    return findings;
  },
};

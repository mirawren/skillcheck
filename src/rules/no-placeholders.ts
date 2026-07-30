import { scanPlaceholders } from "../scan.js";
import type { Finding, Rule } from "../types.js";

/**
 * Unfinished placeholder content shipped in a SKILL.md body. The body is the
 * instruction set the model follows once the skill loads, so a stray `TODO`,
 * `FIXME`, or `lorem ipsum` is either a note the model may act on literally or
 * a sign the skill was published half-written.
 *
 * The patterns are kept tight — uppercase markers and obvious templating — so
 * ordinary prose never trips them. They live in src/scan.ts, shared with the
 * same check over AGENTS.md and CLAUDE.md.
 */
export const noPlaceholders: Rule = {
  id: "no-placeholders",
  summary: "body ships no TODO/FIXME/placeholder leftovers",
  docs: {
    why: "The model reads the body as instructions, not as source code it should skim past. A leftover `TODO` or `<your-api-key>` is either followed literally or treated as a gap to improvise around, and both fail in front of a user. The same check runs over AGENTS.md and CLAUDE.md, where the marker is read at the start of every session rather than only when a skill fires.",
    bad: "Authenticate with <your-api-key>.\n\nTODO: document the retry behaviour",
    good: "Authenticate with the key in the `REPORT_API_KEY` environment variable. Retry twice on a 5xx, then report the failure.",
  },
  check(doc): Finding[] {
    return scanPlaceholders(doc, {
      ruleId: this.id,
      subject: "body",
      detail:
        "The model reads the whole body when the skill fires; unfinished markers get followed or confuse it. Remove them before shipping.",
    });
  },
};

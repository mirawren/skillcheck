import { scanReferences } from "../scan.js";
import type { Finding, Rule } from "../types.js";

/** What a dead reference costs, in either document kind. See src/scan.ts. */
export const DEAD_REFERENCE_DETAIL =
  "The model will try to read this path at runtime and silently fail. Fix the path or add the file.";

/**
 * Skills routinely ship with references/, scripts/, templates/ alongside
 * SKILL.md. A body that points the model at a file that doesn't exist fails
 * silently at runtime — the model just follows a dead pointer.
 *
 * The detection is shared with the same check over AGENTS.md and CLAUDE.md,
 * where a dead path costs exactly the same and is read on every request rather
 * than only on activation.
 */
export const brokenReferences: Rule = {
  id: "broken-references",
  summary: "relative links in the body point at files that actually exist",
  docs: {
    why: "Skills routinely ship references/, scripts/ and templates/ next to SKILL.md and point the model at them. A path that doesn't exist fails at runtime, on the user's machine, with no error you'll ever see — the model reads a dead pointer and improvises. The same check runs over AGENTS.md and CLAUDE.md, including their `@path` imports.",
    bad: "See [the template](templates/report.html) for the layout.",
    good: "See [the template](templates/report.hbs) for the layout.  # the file that is actually committed",
  },
  check(doc): Finding[] {
    return scanReferences(doc, {
      ruleId: this.id,
      severity: "error",
      where: "in the skill folder",
      detail: DEAD_REFERENCE_DETAIL,
    });
  },
};

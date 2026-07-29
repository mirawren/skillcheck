import { languageOf } from "../match.js";
import { fold } from "../script.js";
import type { Finding, Rule } from "../types.js";

/**
 * Anthropic's Skill best-practices doc is explicit: "Always write in third
 * person. The description is injected into the system prompt, and inconsistent
 * point-of-view can cause discovery problems." It rejects "I can help you
 * process Excel files" and "You can use this to…" in favor of "Processes Excel
 * files…". A documented discovery RISK (magnitude unmeasured), so: warning.
 *
 * The patterns live in the language packs, and a pack may legitimately omit
 * them: several languages mark politeness rather than person, or drop the
 * subject entirely, and in those the distinction this rule is about does not
 * cleanly exist. A pack with no `firstPerson` list simply never trips it —
 * better than inventing a rule for a grammar that doesn't have one.
 */
export const descriptionThirdPerson: Rule = {
  id: "description-third-person",
  summary: "`description` is third person, not “I can help you…” (Anthropic guidance)",
  docs: {
    why: 'Anthropic\'s skill-authoring guidance is explicit: "Always write in third person." The description is injected into the system prompt next to every other skill\'s, and a first-person sentence there reads as the assistant speaking rather than as a catalogue entry, which is documented to hurt discovery. Recognized per language, and skipped for languages whose packs do not define the distinction.',
    bad: "description: I can help you process Excel files and build charts for you.",
    good: "description: Processes Excel workbooks and builds charts from them. Use when the user asks to analyze a spreadsheet or chart tabular data.",
  },
  check(doc): Finding[] {
    if (!doc.description) return [];
    const patterns = languageOf(doc).pack?.firstPerson;
    if (!patterns?.length) return [];
    if (!patterns.some((re) => re.test(fold(doc.description!)))) return [];
    return [
      {
        ruleId: this.id,
        severity: "warning",
        message: "`description` is written in first/second person (“I…/You can use this…”)",
        file: doc.file,
        line: 1,
        detail:
          'Anthropic\'s Skill authoring guidance: "Always write in third person" — the description is injected into the system prompt and a mixed point of view hurts discovery. Rewrite as a capability + trigger, e.g. "Processes Excel files. Use when the user asks to…".',
      },
    ];
  },
};

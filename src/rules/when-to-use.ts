import { en } from "../languages/en.js";
import { LANGUAGES, LOW_CONFIDENCE } from "../languages/index.js";
import { languageOf } from "../match.js";
import { fold } from "../script.js";
import type { Rule } from "../types.js";

/**
 * The flagship rule.
 *
 * A skill's description is the only thing the model reads when deciding
 * whether to load it. Descriptions that only state a capability
 * ("Provides PDF tools") without naming the situations that should trigger
 * it are the best-documented cause of skills that fire ~half the time or
 * never. This rule requires an explicit when-to-use signal.
 *
 * Which phrasings count depends on the language, so the patterns live in the
 * language packs (src/languages/) rather than here. Getting that wrong is
 * uniquely expensive for this rule: it reports an **error**, and an
 * English-only pattern list meant every well-written Japanese, Spanish or
 * Russian skill was told it had no trigger clause when it plainly did. Nobody
 * keeps a linter that is wrong about every file they own.
 *
 * So the fallbacks all lean the same way — toward staying quiet:
 *
 *   - English patterns are tested **in addition** to the detected language's,
 *     because technical descriptions mix English in constantly.
 *   - When detection is unsure, every language sharing the script is accepted.
 *   - A language with no pack at all is never reported on.
 */
export const whenToUse: Rule = {
  id: "when-to-use",
  summary: "`description` says WHEN to use the skill, not only what it does",
  docs: {
    why: "The description is the only text the model reads before deciding whether to load a skill, and it is answering one question: does this apply to what the user just asked? A description that only advertises a capability leaves that question unanswered, so the skill fires when the wording happens to line up and stays silent when it doesn't. Trigger phrasings are recognized in every language skillcheck has a pack for, and the rule stays silent for languages it does not — see docs/languages.md.",
    bad: "description: Provides comprehensive PDF manipulation utilities.",
    good: "description: Manipulates PDF files — extract text, fill forms, merge documents. Use when the user asks to read, edit, split or combine a PDF.",
  },
  check(doc) {
    if (!doc.description) return [];

    const language = languageOf(doc);
    // No pack for this language: skillcheck cannot tell a trigger clause from a
    // capability clause here, and guessing would report an error on a
    // description that may be perfectly good. Silence is the honest answer.
    if (!language.pack) return [];

    const folded = fold(doc.description);
    const packs =
      language.confidence < LOW_CONFIDENCE
        ? // Thin evidence — a three-word description, or one made entirely of
          // product names. Accept a trigger phrasing from any language written
          // in the same script rather than insisting on the guess.
          LANGUAGES.filter((pack) => pack.scripts.some((s) => language.pack!.scripts.includes(s)))
        : [language.pack, en];

    for (const pack of packs) {
      if (pack.triggerSignals.some((re) => re.test(folded))) return [];
    }

    return [
      {
        ruleId: this.id,
        severity: "error" as const,
        message:
          "`description` never says when to use this skill — it describes a capability, not a trigger",
        file: doc.file,
        line: 1,
        detail:
          'The model picks skills by matching the request against the description. Add trigger contexts, e.g. "Use when the user asks to extract text from a PDF, fill a PDF form, or merge PDF files." Capability-only descriptions are the top documented cause of skills that activate ~50% of the time.',
      },
    ];
  },
};

import { numberOption } from "../config.js";
import { describeLanguage } from "../languages/index.js";
import { indexFor, type IndexedSkill } from "../match.js";
import { isContinuous, scriptOf } from "../script.js";
import type { Finding, Rule } from "../types.js";

/** Anchors below this many terms aren't enough to reach a skill from outside. */
const DEFAULT_MIN_ANCHORS = 1;

/**
 * The failure that only exists once a repo has authors from more than one
 * country.
 *
 * A model picks a skill by matching a request against its description, and two
 * languages share almost no vocabulary. So a skill described only in Japanese
 * is not merely outranked by an English request — it is *unreachable* by one,
 * because there is no term in common to rank on. On a team where one person
 * writes skills in their language and another asks questions in theirs, each
 * half is invisible to the other, and nothing reports it. The skill loads fine.
 * Every other lint passes. It simply never fires for half the people who have
 * it installed.
 *
 * What rescues it is usually already in the sentence: the format and product
 * names that stay Latin in every language. `PDF`, `Markdown`, `Excel`, `git`,
 * `Kubernetes` are what a request contains whatever language it is asked in,
 * and one of them is enough to make a description reachable from outside.
 *
 * Two conditions keep this narrow enough to be worth reporting:
 *
 *   - **The repo must already be multilingual.** A repo written entirely in one
 *     language works perfectly and is nobody's business but its authors'.
 *   - **Only non-Latin descriptions are judged.** Not out of deference to
 *     English, but because the mechanism is asymmetric: technical vocabulary is
 *     Latin everywhere, so a description already written in Latin script shares
 *     terms with requests in other languages by default, and one in another
 *     script may share none at all.
 */
export const crossLanguageTrigger: Rule = {
  id: "cross-language-trigger",
  summary: "in a multilingual repo, every skill can be reached from the other languages in it",
  docs: {
    why: "A skill is selected by matching a request against its description, and two languages have almost no words in common — so a skill described only in Japanese is not merely outranked by an English request, it is unreachable by one. In a repo whose own skills span several languages that gap is silent and permanent: the skill installs, validates, and never fires for the half of the team asking in the other language. Format and product names (PDF, Markdown, git, Excel) are the terms that survive translation, and one of them is enough to keep a description reachable. Only fires in a repo that already contains more than one language, and only for descriptions written outside the Latin script, where the gap can be total.",
    bad: `# skills/pdf-report/SKILL.md  — in a repo that also contains English skills
description: マークダウンから印刷用の文書を作成します。文書の作成を依頼されたときに使用してください。`,
    good: `# skills/pdf-report/SKILL.md  — "Markdown" and "PDF" reach it from any language
description: Markdown から PDF レポートを生成します。PDF の作成や印刷用ドキュメントの生成を依頼されたときに使用してください。`,
  },
  options: [
    {
      name: "minAnchors",
      type: "number",
      default: DEFAULT_MIN_ANCHORS,
      description:
        "Latin-script terms (PDF, Markdown, git…) a non-Latin description needs to stay reachable from another language.",
    },
  ],
  check(doc, ctx): Finding[] {
    if (!doc.description || doc.parseError) return [];
    const index = indexFor(ctx.skills);
    if (index.skills.length < 2) return [];

    const self = index.byFile.get(doc.file);
    if (!self) return [];
    if (self.language.pack?.scripts.includes("latin") !== false) return [];

    // Only a repo that already spans languages has this problem to report.
    const languages = new Set(index.skills.map((s) => s.language.pack?.code ?? "?"));
    if (languages.size < 2) return [];

    const min = numberOption(ctx.options[this.id], "minAnchors", DEFAULT_MIN_ANCHORS);
    if (anchorTerms(self).length >= min) return [];

    const others = languages.size - 1;
    return [
      {
        ruleId: this.id,
        severity: "warning",
        message: `described only in ${describeLanguage(self.language)}, with no term a request in another language could match — unreachable from the ${others === 1 ? "other language" : `other ${others} languages`} in this repo`,
        file: doc.file,
        line: 1,
        detail:
          "Skills here are described in more than one language, and this description shares no vocabulary with the rest — a request in any of them matches nothing in it. Naming the formats and tools involved (PDF, Markdown, CSV, git, Excel) usually fixes it, because those words stay the same in every language. `skillcheck languages` shows the split.",
      },
    ];
  },
};

/**
 * Terms in this description that a request in another language could plausibly
 * contain: the Latin-script ones.
 *
 * In a description written in another script these are, in practice, exactly
 * the proper nouns — file formats, tools, protocols, product names — which is
 * why they work as anchors. Deriving them mechanically rather than from a list
 * means the check needs no maintenance as the ecosystem invents new ones.
 */
function anchorTerms(skill: IndexedSkill): string[] {
  return [...skill.descTerms].filter((term) => {
    const script = scriptOf(term.codePointAt(0)!);
    // A bigram out of a continuous script is a fragment, never a shared anchor.
    return script === "latin" && !isContinuous(script);
  });
}

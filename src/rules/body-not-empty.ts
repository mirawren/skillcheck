import { numberOption } from "../config.js";
import { proseLines } from "../markdown.js";
import { countWords } from "../text.js";
import type { Finding, Rule } from "../types.js";

const DEFAULT_MIN_WORDS = 5;

/**
 * Count words that carry instructions — excluding heading lines, code, and link
 * URLs — so a skill that is just a title (or a title plus a one-line restatement
 * of its name) is recognized as having no real body.
 *
 * Counting is Unicode-aware ({@link countWords}), which it very much has to be:
 * an ASCII word regex reports a full page of Russian or Chinese instructions as
 * zero words and warns that the body is empty, which is both wrong and the most
 * insulting way to be wrong.
 */
export function instructionalWordCount(body: string): number {
  // Code removal is shared with broken-references and no-placeholders (see
  // src/markdown.ts) rather than kept as a second, weaker regex here: this one
  // missed `~~~` fences and indented ones, so the two rules disagreed about
  // what counted as code in the same file.
  const cleaned = proseLines(body.replace(/<!--[\s\S]*?-->/g, " "))
    .filter((line): line is string => line !== null)
    .filter((line) => !/^\s*#{1,6}\s/.test(line)) // drop ATX heading lines
    .join("\n")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // keep link text, drop URL
  return countWords(cleaned);
}

/**
 * A skill whose SKILL.md body has (almost) no prose can't guide the model once
 * it loads — the description gets it picked, but there's nothing to act on.
 */
export const bodyNotEmpty: Rule = {
  id: "body-not-empty",
  summary: "body has actual instructional content, not just a title",
  docs: {
    why: "The description gets a skill selected; the body is what the model actually follows once it loads. A body that is only a heading costs a tool call and a context window to deliver nothing, which reads to the user as the skill firing and then doing nothing.",
    bad: `---
name: pdf-report
description: Generates PDF reports. Use when the user asks for a PDF.
---

# PDF Report`,
    good: `---
name: pdf-report
description: Generates PDF reports. Use when the user asks for a PDF.
---

# PDF Report

1. Collect the source content (markdown, CSV or JSON).
2. Render it through the house template.
3. Confirm the page count before returning the file.`,
  },
  options: [
    {
      name: "minWords",
      type: "number",
      default: DEFAULT_MIN_WORDS,
      description: "Instructional words required before the body counts as non-empty.",
    },
  ],
  check(doc, ctx): Finding[] {
    // Malformed frontmatter is frontmatter-valid's job; don't double-report.
    if (doc.parseError) return [];
    const min = numberOption(ctx.options[this.id], "minWords", DEFAULT_MIN_WORDS);
    const words = instructionalWordCount(doc.body);
    if (words >= min) return [];
    return [
      {
        ruleId: this.id,
        severity: "warning",
        message: `body has almost no instructional content (${words} word${words === 1 ? "" : "s"})`,
        file: doc.file,
        line: doc.bodyStartLine,
        detail:
          "The description gets the skill selected; the body is what the model follows next. Add the steps, rules, or examples the skill should apply.",
      },
    ];
  },
};

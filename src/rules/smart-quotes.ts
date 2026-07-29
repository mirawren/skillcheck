import { frontmatterRange } from "../frontmatter.js";
import type { Finding, Rule, TextEdit } from "../types.js";

/**
 * Typographic look-alikes → their ASCII equivalent. Editors and word
 * processors silently "curl" quotes and dashes when authors paste prose into
 * frontmatter. Hosts read `name`/`description` literally, so a curly quote used
 * as a YAML delimiter isn't stripped, and curly punctuation subtly weakens the
 * literal matching that decides whether a skill triggers.
 *
 * Built from code points (not literal glyphs) so the mapping is unambiguous in
 * source — several of these characters are visually indistinguishable.
 */
const REPLACEMENTS: Record<string, string> = Object.fromEntries(
  (
    [
      [0x2018, "'"], // left single quote
      [0x2019, "'"], // right single quote / apostrophe
      [0x201a, "'"], // single low-9 quote
      [0x201b, "'"], // single high-reversed-9 quote
      [0x201c, '"'], // left double quote
      [0x201d, '"'], // right double quote
      [0x201e, '"'], // double low-9 quote
      [0x201f, '"'], // double high-reversed-9 quote
      [0x2032, "'"], // prime
      [0x2033, '"'], // double prime
      [0x2013, "-"], // en dash
      [0x2014, "-"], // em dash
      [0x2212, "-"], // minus sign
      [0x2026, "..."], // horizontal ellipsis
      [0x00a0, " "], // no-break space
      [0x202f, " "], // narrow no-break space
      [0x2009, " "], // thin space
    ] as [number, string][]
  ).map(([code, ascii]) => [String.fromCodePoint(code), ascii]),
);

/** Only scan the frontmatter block — em dashes etc. are legitimate in prose. */
export const smartQuotes: Rule = {
  id: "smart-quotes",
  summary: "frontmatter uses plain ASCII, not curly quotes / typographic dashes",
  docs: {
    why: "Editors and docs tools silently curl quotes and dashes in pasted prose. A curly quote is not a YAML string delimiter, so a strict loader either errors or reads the quote as part of the value — and the same skill that loads fine in one host fails in another. Non-breaking spaces are worse: invisible, and they change the text the model matches on.",
    bad: "description: “Generates reports” — use when asked for a summary.",
    good: 'description: "Generates reports - use when asked for a summary."',
  },
  fixable: true,
  check(doc): Finding[] {
    const range = frontmatterRange(doc.raw);
    if (!range) return [];
    let count = 0;
    let firstOffset = -1;
    for (let i = range.start; i < range.end; i++) {
      if (REPLACEMENTS[doc.raw[i]] !== undefined) {
        count++;
        if (firstOffset === -1) firstOffset = i;
      }
    }
    if (count === 0) return [];
    return [
      {
        ruleId: this.id,
        severity: "warning",
        message: `frontmatter has ${count} typographic character${count === 1 ? "" : "s"} (curly quote/dash) — not portable across strict YAML parsers`,
        file: doc.file,
        line: lineOfOffset(doc.raw, firstOffset),
        detail:
          "Editors auto-curl pasted quotes and dashes. Claude Code parses leniently, but strict YAML loaders on other hosts choke on them (a curly quote used as a delimiter isn't stripped). Run `skillcheck --fix` to replace them with ASCII.",
      },
    ];
  },
  fix(doc): TextEdit[] {
    const range = frontmatterRange(doc.raw);
    if (!range) return [];
    const edits: TextEdit[] = [];
    for (let i = range.start; i < range.end; i++) {
      const replacement = REPLACEMENTS[doc.raw[i]];
      if (replacement !== undefined) edits.push({ start: i, end: i + 1, text: replacement });
    }
    return edits;
  },
};

function lineOfOffset(raw: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < raw.length; i++) {
    if (raw[i] === "\n") line++;
  }
  return line;
}

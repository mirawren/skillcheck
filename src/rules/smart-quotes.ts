import { frontmatterRange } from "../frontmatter.js";
import type { Finding, Rule, TextEdit } from "../types.js";

/**
 * Typographic characters in frontmatter that a host can actually get wrong.
 *
 * This rule used to flag every curled character — en dash, em dash, minus sign,
 * ellipsis included — on the theory that they aren't portable across strict YAML
 * parsers. They are. An em dash inside a plain scalar is an ordinary character to
 * every YAML 1.1 and 1.2 loader in existence, and the proof was embarrassing:
 * copying the `when-to-use` rule's own documented "Passes" example into a skill
 * produced a `smart-quotes` warning. The tool flagged its own documentation.
 *
 * What remains is the subset with a named failure, which is what every rule here
 * is required to have:
 *
 *   - **Invisible spaces.** A no-break space is not whitespace to a YAML parser,
 *     so `name: pdf-report` yields the value ` pdf-report` — or a
 *     parse error where it lands in indentation. It is also invisible in every
 *     editor and diff view, which makes it the one character an author cannot
 *     debug by looking, and it changes the text the model matches on.
 *   - **Curly quotes wrapping a whole value.** `description: “Generates reports”`
 *     looks quoted and isn't: the value is a plain scalar and the quote marks are
 *     part of the string, so the host stores a description the author never
 *     wrote. Only this shape is reported — an author who typed those marks meant
 *     them as delimiters.
 *
 * Everything else is left alone, including a lone opening curly quote. That case
 * is a judgement call the fixer cannot win: replacing `“` with `"` in
 * `description: “Generates reports” - use when asked` produces an unterminated
 * double-quoted scalar, turning a cosmetic oddity into a file that genuinely
 * won't parse. A fix that can break a working file has no business being called
 * safe, and an author's apostrophe in "don’t" is not a defect at all.
 */

const INVISIBLE_SPACES: Record<string, string> = Object.fromEntries(
  (
    [
      [0x00a0, " "], // no-break space
      [0x202f, " "], // narrow no-break space
      [0x2009, " "], // thin space
      [0x2007, " "], // figure space
      [0xfeff, ""], // zero-width no-break space / BOM
      [0x200b, ""], // zero-width space
    ] as [number, string][]
  ).map(([code, ascii]) => [String.fromCodePoint(code), ascii]),
);

/**
 * Curly quote pairs that wrap a value, as `[opener, closer, ascii]`.
 *
 * Matched as pairs precisely so a fix replaces both ends or neither.
 */
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  [0x201c, 0x201d, '"'], // “ … ”
  [0x201e, 0x201c, '"'], // „ … “  (German)
  [0x201f, 0x201d, '"'],
  [0x2018, 0x2019, "'"], // ‘ … ’
  [0x201a, 0x2018, "'"],
  [0x00ab, 0x00bb, '"'], // « … »  (French, Russian)
].map(([open, close, ascii]) => [
  String.fromCodePoint(open as number),
  String.fromCodePoint(close as number),
  ascii as string,
]) as ReadonlyArray<readonly [string, string, string]>;

interface Problem {
  offset: number;
  char: string;
  /** ASCII to substitute, or null when the finding is reportable but not fixable. */
  replacement: string | null;
  kind: "space" | "quote";
}

/** The other ASCII quote, tried when the body already contains the first choice. */
const OTHER_QUOTE: Record<string, string> = { '"': "'", "'": '"' };

/**
 * Every character in the frontmatter worth reporting, with the offset to fix.
 *
 * Quotes are only collected as a matched pair wrapping an entire value, so a fix
 * either replaces both delimiters or touches neither and can never leave a
 * half-quoted scalar behind.
 */
function problems(raw: string): Problem[] {
  const range = frontmatterRange(raw);
  if (!range) return [];
  const found: Problem[] = [];

  for (let i = range.start; i < range.end; i++) {
    const replacement = INVISIBLE_SPACES[raw[i]];
    if (replacement !== undefined) {
      found.push({ offset: i, char: raw[i], replacement, kind: "space" });
    }
  }

  for (const line of frontmatterLines(raw, range)) {
    /**
     * Any line that carries a value, not just a top-level `key:`.
     *
     * Nested keys and list items are where this bites hardest in practice:
     * curly quotes around an `allowed-tools:` entry are kept verbatim, so the
     * host reads a tool name that does not exist and the skill silently runs
     * with different permissions than its author wrote. Restricting the scan to
     * unindented keys missed exactly that case.
     */
    const match = /^[ \t]*(?:-[ \t]+)?(?:[A-Za-z0-9_.\-]+[ \t]*:[ \t]*)?(?=\S)/.exec(line.text);
    if (!match || match[0].length === line.text.length) continue;
    const valueStart = line.start + match[0].length;
    const valueEnd = line.start + line.text.trimEnd().length - 1;
    if (valueEnd <= valueStart) continue;
    const pair = QUOTE_PAIRS.find(([open, close]) => raw[valueStart] === open && raw[valueEnd] === close);
    if (!pair) continue;

    /**
     * Substituting the delimiters is only safe if the text between them does not
     * already contain the quote being substituted in.
     *
     * `“Runs the "fast" suite. Use when asked.”` is valid YAML — a plain scalar
     * whose curly quotes are ordinary characters. Replacing both ends with `"`
     * produced `"Runs the "fast" suite…"`, which no YAML loader accepts: a
     * loadable file turned unloadable, on disk, by the rule that documents
     * itself as never doing that. The other ASCII quote is tried first, and when
     * the body contains both the finding is still reported and simply carries no
     * edit — the author decides.
     */
    const body = raw.slice(valueStart + 1, valueEnd);
    const ascii = !body.includes(pair[2])
      ? pair[2]
      : !body.includes(OTHER_QUOTE[pair[2]])
        ? OTHER_QUOTE[pair[2]]
        : null;
    if (ascii === null) {
      found.push({ offset: valueStart, char: pair[0], replacement: null, kind: "quote" });
      continue;
    }
    found.push({ offset: valueStart, char: pair[0], replacement: ascii, kind: "quote" });
    found.push({ offset: valueEnd, char: pair[1], replacement: ascii, kind: "quote" });
  }

  return found.sort((a, b) => a.offset - b.offset);
}

function frontmatterLines(
  raw: string,
  range: { start: number; end: number },
): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let start = range.start;
  while (start < range.end) {
    let nl = raw.indexOf("\n", start);
    if (nl === -1 || nl > range.end) nl = range.end;
    let text = raw.slice(start, nl);
    if (text.endsWith("\r")) text = text.slice(0, -1);
    out.push({ text, start });
    start = nl + 1;
  }
  return out;
}

export const smartQuotes: Rule = {
  id: "smart-quotes",
  summary: "frontmatter has no invisible spaces, and no value wrapped in curly quotes",
  docs: {
    why: "A no-break space is not whitespace to a YAML parser, so it either stays inside the value or breaks the indentation — and it is invisible in every editor and diff, so it cannot be debugged by looking. Curly quotes wrapping a value fail the same way: the value looks quoted, but the marks are part of the string, so the host stores a description the author never wrote. Curly punctuation inside prose — an apostrophe, a dash, an ellipsis — is portable and is deliberately not reported.",
    bad: 'description: “Generates PDF reports. Use when the user asks for a PDF.”',
    good: 'description: "Generates PDF reports. Use when the user asks for a PDF."',
  },
  fixable: true,
  check(doc): Finding[] {
    const found = problems(doc.raw);
    if (found.length === 0) return [];

    const spaces = found.filter((p) => p.kind === "space").length;
    const quotes = found.filter((p) => p.kind === "quote").length;
    const parts: string[] = [];
    if (spaces > 0) {
      parts.push(`${spaces} invisible space character${spaces === 1 ? "" : "s"}`);
    }
    if (quotes > 0) parts.push("a value wrapped in curly quotes that a host will keep");

    return [
      {
        ruleId: this.id,
        severity: "warning",
        message: `frontmatter has ${parts.join(" and ")} — hosts read the value differently than you see it`,
        file: doc.file,
        line: lineOfOffset(doc.raw, found[0].offset),
        detail:
          "Editors insert these silently when prose is pasted in. Claude Code parses leniently; strict YAML loaders on other hosts do not. Run `skillcheck --fix` to replace them with ASCII.",
      },
    ];
  },
  fix(doc): TextEdit[] {
    // A problem with no replacement is reportable and not mechanically fixable.
    return problems(doc.raw)
      .filter((p): p is Problem & { replacement: string } => p.replacement !== null)
      .map((p) => ({ start: p.offset, end: p.offset + p.char.length, text: p.replacement }));
  },
};

function lineOfOffset(raw: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < raw.length; i++) {
    if (raw[i] === "\n") line++;
  }
  return line;
}

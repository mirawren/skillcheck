/**
 * The prose half of a SKILL.md body.
 *
 * Two rules read the body looking for things that are wrong — a link to a file
 * that doesn't exist, a leftover `TODO`. Both were reading *code samples* too,
 * which is how a skill whose job is to teach a format gets punished for
 * containing an example of it:
 *
 * ```markdown
 * Flag any leftover markers. A bad file looks like this:
 *
 *     ```markdown
 *     See [the template](templates/missing.html) for details.
 *     TODO: finish this section
 *     ```
 * ```
 *
 * That body is correct. It earned a `broken-references` **error** and a
 * `no-placeholders` warning, because a fenced block is exactly where a
 * deliberately-broken example belongs. A review skill that flags TODOs being
 * flagged for containing the word TODO is the kind of finding that gets a linter
 * deleted — so both rules now read prose only.
 *
 * Line positions are preserved rather than the text being concatenated, because
 * every finding these rules emit anchors to a line number a person will open.
 */

/**
 * A fence opener/closer: any indent and any number of blockquote markers, then
 * ``` or ~~~.
 *
 * Both prefixes are allowed rather than capped at CommonMark's three columns,
 * because the two places a skill body actually puts a code sample are inside a
 * numbered step and inside a blockquote. A fence in a list item must be indented
 * to the item's content column — four spaces after `1. ` — and a quoted one is
 * prefixed `> `. Matching neither meant the block was never entered and its
 * contents were read as prose, so the false positive this module exists to
 * eliminate still fired, at error severity, on the shape a skill body mostly
 * consists of.
 *
 * This reintroduces no guessing about four-space *indented code blocks*, which
 * are a different construct: they carry no fence marker at all.
 */
const FENCE = /^(\s*(?:>\s*)*)(`{3,}|~{3,})/;

/**
 * The body's lines, with everything that isn't prose removed:
 *
 *   - a line inside (or delimiting) a fenced code block becomes `null`
 *   - inline code spans are blanked out, keeping the line's length so any column
 *     a caller derives still lines up
 *
 * Indented (four-space) code blocks are deliberately *not* treated as code. They
 * are indistinguishable from continuation lines inside a list without tracking
 * full block structure, and a skill body is mostly lists — guessing wrong would
 * silence real findings in the most common shape a body takes.
 */
export function proseLines(body: string): (string | null)[] {
  const lines = body.split(/\r?\n/);
  const out: (string | null)[] = [];
  let fence: string | null = null;
  let openedAt = -1;

  for (const [i, line] of lines.entries()) {
    const match = FENCE.exec(line);
    if (fence === null) {
      if (match) {
        fence = match[2];
        openedAt = i;
        out.push(null);
        continue;
      }
      out.push(blankInlineCode(line));
      continue;
    }
    // Inside a fence. It closes on a run of the same character at least as long
    // as the opener — the CommonMark rule, and the one that lets a block of
    // markdown contain a shorter fence of its own.
    out.push(null);
    if (match && match[2][0] === fence[0] && match[2].length >= fence.length) {
      fence = null;
      openedAt = -1;
    }
  }

  /**
   * An unclosed fence runs to the end of the document in CommonMark — and being
   * right about that would mean one stray ``` line silently switches two rules
   * off for the whole rest of the body. A linter should fail open: a stray fence
   * is far likelier than a deliberate one, and the cost of being wrong here is a
   * finding the author can dismiss, against a check that stopped running and
   * said nothing.
   */
  if (fence !== null && openedAt !== -1) {
    for (let i = openedAt; i < lines.length; i++) out[i] = blankInlineCode(lines[i]);
  }
  return out;
}

/** Replace `` `code` `` spans with spaces, preserving length. */
function blankInlineCode(line: string): string {
  return line.replace(/`[^`]*`/g, (span) => " ".repeat(span.length));
}

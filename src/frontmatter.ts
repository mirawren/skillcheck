/**
 * Small, offset-aware helpers over a SKILL.md's raw text. Autofixers need to
 * edit exact character ranges (a key token, a field's value, the frontmatter
 * block) without re-serializing the YAML — re-serializing would clobber the
 * author's formatting and comments. Everything here is pure over `raw`.
 */

const FENCE = /^---\s*$/;

interface Line {
  text: string;
  /** Character offset in `raw` where this line begins. */
  start: number;
}

/** Split `raw` into lines with their start offsets, tolerant of \r\n. */
function scanLines(raw: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  for (let i = 0; i <= raw.length; i++) {
    if (i === raw.length || raw[i] === "\n") {
      let text = raw.slice(start, i);
      if (text.endsWith("\r")) text = text.slice(0, -1);
      out.push({ text, start });
      start = i + 1;
    }
  }
  return out;
}

/** Index of the closing `---` fence, or -1 when frontmatter is absent/unclosed. */
function closingFence(lines: Line[]): number {
  if (!FENCE.test(lines[0]?.text ?? "")) return -1;
  for (let i = 1; i < lines.length; i++) {
    if (FENCE.test(lines[i].text)) return i;
  }
  return -1;
}

/** Character range `[start, end)` of the frontmatter content (between fences). */
export function frontmatterRange(raw: string): { start: number; end: number } | null {
  const lines = scanLines(raw);
  const closing = closingFence(lines);
  if (closing === -1) return null;
  const start = lines[1]?.start ?? lines[closing].start;
  return { start, end: lines[closing].start };
}

export interface FieldLoc {
  /** 0-based line index within `raw`. */
  line: number;
  /** Offsets of the key token itself (for renaming a key). */
  keyStart: number;
  keyEnd: number;
  /** Offsets of the raw value text, trailing whitespace excluded. */
  valueStart: number;
  valueEnd: number;
  /** The raw value text (may include surrounding quotes). */
  value: string;
  /** The quote character when the value is a quoted scalar, else null. */
  quoted: '"' | "'" | null;
}

const TOP_LEVEL_FIELD = /^([A-Za-z0-9_.\-]+)([ \t]*):(.*)$/;

/**
 * Locate a top-level `key: value` line in the frontmatter (indented/nested keys
 * are ignored, so we never touch a value that lives under another key). Returns
 * offsets for both the key token and its value, or null when absent.
 */
export function frontmatterField(raw: string, key: string): FieldLoc | null {
  const lines = scanLines(raw);
  const closing = closingFence(lines);
  if (closing === -1) return null;

  for (let i = 1; i < closing; i++) {
    const { text, start } = lines[i];
    const m = TOP_LEVEL_FIELD.exec(text);
    if (!m || m[1] !== key) continue;

    const keyStart = start;
    const keyEnd = start + m[1].length;
    const afterColon = start + m[1].length + m[2].length + 1; // +1 for ':'
    const rest = m[3];
    const leading = rest.length - rest.trimStart().length;
    const trimmed = rest.trim();
    const valueStart = afterColon + leading;
    const valueEnd = valueStart + trimmed.length;
    return { line: i, keyStart, keyEnd, valueStart, valueEnd, value: trimmed, quoted: detectQuote(trimmed) };
  }
  return null;
}

function detectQuote(value: string): '"' | "'" | null {
  if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) {
    return value[0] as '"' | "'";
  }
  return null;
}

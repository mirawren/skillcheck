/**
 * Unicode script classification — the layer that lets every other check work in
 * a language other than English.
 *
 * skillcheck's original tokenizer split on `[^a-z0-9]+`, which silently deleted
 * every character outside ASCII. A Japanese description became two English
 * loanwords; a Russian one became nothing at all. Every downstream check —
 * similarity, shadowing, `why`, the scenarios — then reasoned about that empty
 * set and reported confident nonsense.
 *
 * So segmentation has to start from what script a character is in, because
 * scripts, not languages, decide two mechanical things:
 *
 *   1. **Where words end.** Latin, Cyrillic, Arabic and friends put spaces
 *      between words. Han, Kana, Hangul and the Southeast Asian abugidas do
 *      not, so they need n-grams instead (see {@link isContinuous}).
 *   2. **What a character costs.** A token is roughly four Latin characters but
 *      roughly one Han character, which is why the old 4-chars-per-token
 *      estimate under-reported a Japanese skill's context cost fourfold.
 *
 * Range tables are inlined rather than pulled from a Unicode package on
 * purpose: skillcheck ships two runtime dependencies and no postinstall, and
 * that property is load-bearing for running it on a fork's pull request.
 */

/**
 * Script classes skillcheck distinguishes.
 *
 * Coarser than Unicode's own script property — several scripts that behave
 * identically for both segmentation and token cost are folded together
 * (`brahmic` covers the Indic abugidas past Devanagari). `common` is the
 * catch-all for characters that belong to no script in particular — digits,
 * combining marks, symbols, emoji — and that therefore attach to whatever run
 * they appear in rather than starting one of their own.
 */
export type Script =
  | "latin"
  | "greek"
  | "cyrillic"
  | "hebrew"
  | "arabic"
  | "armenian"
  | "georgian"
  | "ethiopic"
  | "devanagari"
  | "brahmic"
  | "thai"
  | "lao"
  | "khmer"
  | "myanmar"
  | "han"
  | "kana"
  | "hangul"
  | "common";

/** `[start, end, script]`, sorted by `start`; ranges never overlap. */
type Range = readonly [number, number, Script];

/**
 * Non-ASCII script ranges, sorted for binary search.
 *
 * Only the blocks that carry *letters* are listed. Anything unlisted resolves
 * to `common`, which is the right answer for punctuation and symbols and a
 * harmless one for a script nobody has written a skill in yet: unlisted letters
 * still tokenize, they just tokenize as space-delimited words, which is the
 * correct behavior for the large majority of the world's writing systems.
 */
const RANGES: readonly Range[] = [
  [0x00c0, 0x024f, "latin"], // Latin-1 Supplement + Extended-A/B
  [0x0250, 0x02af, "latin"], // IPA extensions
  [0x0370, 0x03ff, "greek"],
  [0x0400, 0x052f, "cyrillic"], // Cyrillic + Supplement
  [0x0530, 0x058f, "armenian"],
  [0x0590, 0x05ff, "hebrew"],
  [0x0600, 0x06ff, "arabic"],
  [0x0700, 0x074f, "arabic"], // Syriac — same family for our purposes
  [0x0750, 0x077f, "arabic"], // Arabic Supplement
  [0x0780, 0x07bf, "arabic"], // Thaana
  [0x0870, 0x08ff, "arabic"], // Arabic Extended-A/B
  [0x0900, 0x097f, "devanagari"],
  [0x0980, 0x0dff, "brahmic"], // Bengali → Sinhala
  [0x0e00, 0x0e7f, "thai"],
  [0x0e80, 0x0eff, "lao"],
  [0x0f00, 0x0fff, "brahmic"], // Tibetan
  [0x1000, 0x109f, "myanmar"],
  [0x10a0, 0x10ff, "georgian"],
  [0x1100, 0x11ff, "hangul"], // Hangul Jamo
  [0x1200, 0x139f, "ethiopic"],
  [0x1780, 0x17ff, "khmer"],
  [0x1e00, 0x1eff, "latin"], // Latin Extended Additional (Vietnamese)
  [0x1f00, 0x1fff, "greek"], // Greek Extended
  [0x2c60, 0x2c7f, "latin"], // Latin Extended-C
  [0x2d00, 0x2d2f, "georgian"],
  [0x2de0, 0x2dff, "cyrillic"], // Cyrillic Extended-A
  [0x3040, 0x309f, "kana"], // Hiragana
  [0x30a0, 0x30ff, "kana"], // Katakana
  [0x3105, 0x312f, "han"], // Bopomofo
  [0x3130, 0x318f, "hangul"], // Hangul Compatibility Jamo
  [0x31f0, 0x31ff, "kana"], // Katakana Phonetic Extensions
  [0x3400, 0x4dbf, "han"], // CJK Extension A
  [0x4e00, 0x9fff, "han"], // CJK Unified Ideographs
  [0xa720, 0xa7ff, "latin"], // Latin Extended-D
  [0xa960, 0xa97f, "hangul"], // Hangul Jamo Extended-A
  [0xab30, 0xab6f, "latin"], // Latin Extended-E
  [0xac00, 0xd7af, "hangul"], // Hangul Syllables
  [0xd7b0, 0xd7ff, "hangul"], // Hangul Jamo Extended-B
  [0xf900, 0xfaff, "han"], // CJK Compatibility Ideographs
  [0xfb00, 0xfb4f, "hebrew"], // Alphabetic Presentation Forms
  [0xfb50, 0xfdff, "arabic"], // Arabic Presentation Forms-A
  [0xfe70, 0xfeff, "arabic"], // Arabic Presentation Forms-B
  [0xff66, 0xff9f, "kana"], // Halfwidth Katakana
  [0x1e900, 0x1e95f, "arabic"], // Adlam
  [0x20000, 0x2fa1f, "han"], // CJK Extensions B+ and Compatibility Supplement
];

/**
 * The script a single code point belongs to.
 *
 * ASCII is answered without touching the table — it is the overwhelming
 * majority of what skillcheck reads even in a non-English repo, because code
 * fences, paths, YAML keys and product names stay ASCII everywhere.
 */
export function scriptOf(cp: number): Script {
  if (cp < 0x80) {
    return (cp >= 0x61 && cp <= 0x7a) || (cp >= 0x41 && cp <= 0x5a) ? "latin" : "common";
  }
  let lo = 0;
  let hi = RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end, script] = RANGES[mid];
    if (cp < start) hi = mid - 1;
    else if (cp > end) lo = mid + 1;
    else return script;
  }
  return "common";
}

/**
 * Scripts written without spaces between words ("scriptio continua").
 *
 * These cannot be segmented by looking for whitespace, and segmenting them
 * properly needs a dictionary — which would mean shipping megabytes and giving
 * up the offline guarantee. skillcheck uses overlapping character bigrams
 * instead, the same fallback Lucene's CJK analyzer has used for two decades:
 * approximate, symmetric on both the request and the description, and good
 * enough that retrieval works. See {@link bigrams} in text.ts.
 */
export function isContinuous(script: Script): boolean {
  return (
    script === "han" ||
    script === "kana" ||
    script === "hangul" ||
    script === "thai" ||
    script === "lao" ||
    script === "khmer" ||
    script === "myanmar"
  );
}

/** Whether a code point can be part of a word (letter, digit, or combining mark). */
export function isWordChar(cp: number): boolean {
  if (cp < 0x80) {
    return (
      (cp >= 0x61 && cp <= 0x7a) || (cp >= 0x41 && cp <= 0x5a) || (cp >= 0x30 && cp <= 0x39)
    );
  }
  // Non-ASCII digits and combining marks join whatever run they land in; other
  // symbols (punctuation, emoji, dingbats) break it.
  return scriptOf(cp) !== "common" || isMark(cp) || isNonAsciiDigit(cp);
}

/** Combining marks — decided by regex once, because the ranges are scattered. */
const MARK = /\p{M}/u;
const NON_ASCII_DIGIT = /\p{Nd}/u;

function isMark(cp: number): boolean {
  return MARK.test(String.fromCodePoint(cp));
}

function isNonAsciiDigit(cp: number): boolean {
  return NON_ASCII_DIGIT.test(String.fromCodePoint(cp));
}

/**
 * How many characters of each script `text` contains, letters only.
 *
 * Used two ways: to price a body in tokens ({@link import("./tokens.js")}) and
 * to decide which language pack a description is written in — a text that is
 * 90% Han is Chinese or Japanese no matter what its stopwords say.
 */
export function scriptProfile(text: string): Map<Script, number> {
  const counts = new Map<Script, number>();
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    const script = scriptOf(cp);
    if (script === "common") continue;
    counts.set(script, (counts.get(script) ?? 0) + 1);
  }
  return counts;
}

/**
 * The script most of `text`'s letters are in, or null when it has none.
 *
 * Ties break alphabetically so the answer never depends on Map insertion order
 * — a mixed Japanese/Chinese string must classify the same way on every run or
 * the cached index stops being reproducible.
 */
export function dominantScript(text: string): Script | null {
  let best: Script | null = null;
  let bestCount = 0;
  for (const [script, count] of [...scriptProfile(text)].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (count > bestCount) {
      best = script;
      bestCount = count;
    }
  }
  return best;
}

// ────────────────────────────────────────────────────────── normalization ────

/**
 * Letters no amount of Unicode decomposition will simplify, and their
 * conventional ASCII equivalents.
 *
 * Turkish `ı`, Polish `ł`, Nordic `ø` and German `ß` are single code points
 * with no combining-mark decomposition, so NFD leaves them alone — and a reader
 * who types "isik" for `ışık` or "strasse" for `straße` then matches nothing.
 * Greek final sigma is here for the same reason: `σ` and `ς` are the same
 * letter in different positions and must index identically.
 */
const FOLD_MAP: ReadonlyMap<string, string> = new Map([
  ["ı", "i"],
  ["ø", "o"],
  ["đ", "d"],
  ["ð", "d"],
  ["ł", "l"],
  ["ß", "ss"],
  ["æ", "ae"],
  ["œ", "oe"],
  ["þ", "th"],
  ["ħ", "h"],
  ["ŧ", "t"],
  ["ς", "σ"],
]);

/**
 * Case- and width-normalize. NFKC matters more than it looks: CJK text is
 * routinely typed with fullwidth Latin, so a Japanese description can contain
 * `ＰＤＦ` where its reader will type `PDF`. Those must be the same term.
 */
export function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

/**
 * Scripts whose combining marks are decoration rather than content.
 *
 * Latin accents, Greek tonos, Arabic harakat and Hebrew niqqud are all
 * optional in ordinary writing, so an index that keeps them fails to match the
 * same word typed without them — which is how nearly everyone types. An
 * abugida is the opposite case: in Devanagari or Thai the marks *are* the
 * vowels, and dropping them turns `कि` into `क`.
 */
const STRIP_MARKS: ReadonlySet<Script> = new Set<Script>(["latin", "greek", "arabic", "hebrew"]);

/**
 * Letter-level normalizations that have to happen before decomposition, either
 * because the letters do not decompose at all or because the fold is a
 * convention rather than a Unicode fact.
 *
 * The Arabic entries are the standard set every Arabic search index applies:
 * alef variants collapse, taa marbuta reads as haa, alef maqsura as yaa, and
 * tatweel — a purely typographic stretch — disappears.
 */
const PRE_FOLD: readonly (readonly [RegExp, string])[] = [
  [/ё/g, "е"], // Russian: routinely written as plain `е`
  [/[أإآٱ]/g, "ا"],
  [/ة/g, "ه"],
  [/ى/g, "ي"],
  [/ؤ/g, "و"],
  [/ئ/g, "ي"],
  [/ـ/g, ""], // tatweel
];

/**
 * {@link normalize}, plus accent folding — but only where accents are decoration.
 *
 * This distinction is the whole point of doing it here instead of with a
 * one-line regex: which marks are safe to drop is a property of the script, and
 * getting it wrong silently deletes vowels from half the world's writing.
 *
 * Both a request and a description pass through this identically, so whatever
 * the approximation loses, it loses symmetrically.
 */
export function fold(text: string): string {
  let pre = normalize(text);
  for (const [pattern, replacement] of PRE_FOLD) pre = pre.replace(pattern, replacement);

  let out = "";
  let baseScript: Script = "common";
  for (const char of pre.normalize("NFD")) {
    const cp = char.codePointAt(0)!;
    if (isMark(cp)) {
      if (STRIP_MARKS.has(baseScript)) continue;
      out += char;
      continue;
    }
    baseScript = scriptOf(cp);
    out += FOLD_MAP.get(char) ?? char;
  }
  return out.normalize("NFC");
}

// ────────────────────────────────────────────────────── terminal width ───────

/**
 * East Asian Wide and Fullwidth ranges — the characters a terminal draws two
 * columns across. Sorted for binary search, like {@link RANGES}.
 */
const WIDE: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // Hangul Jamo initial consonants
  [0x2e80, 0x303e], // CJK radicals, Kangxi, CJK symbols and punctuation
  [0x3041, 0x33ff], // Kana, Bopomofo, Hangul Compatibility Jamo, CJK compat
  [0x3400, 0x4dbf], // CJK Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi
  [0xa960, 0xa97f], // Hangul Jamo Extended-A
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe10, 0xfe19], // Vertical forms
  [0xfe30, 0xfe6f], // CJK compatibility forms
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6], // Fullwidth signs
  [0x1f300, 0x1f64f], // Emoji
  [0x1f900, 0x1f9ff], // Supplemental symbols and pictographs
  [0x20000, 0x3fffd], // CJK Extension B and beyond
];

/** ANSI SGR colour sequences, which occupy no columns at all. */
const ANSI = /\u001b\[[0-9;]*m/g;

function isWide(cp: number): boolean {
  let lo = 0;
  let hi = WIDE.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = WIDE[mid];
    if (cp < start) hi = mid - 1;
    else if (cp > end) lo = mid + 1;
    else return true;
  }
  return false;
}

/**
 * How many terminal columns `text` occupies.
 *
 * `String.length` counts UTF-16 code units, which is the wrong number twice
 * over for the languages skillcheck exists to serve: `日本語` is three code
 * units but six columns, and a combining mark is one code unit and no columns
 * at all. Padding with the wrong number is why a table of skill names lines up
 * in English and comes apart in Japanese — in exactly the output that is
 * supposed to demonstrate the tool works outside English.
 */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text.replace(ANSI, "")) {
    const cp = char.codePointAt(0)!;
    if (ZERO_WIDTH.test(char)) continue;
    width += isWide(cp) ? 2 : 1;
  }
  return width;
}

/**
 * Marks that consume no column: nonspacing (Mn) and enclosing (Me).
 *
 * Not `\p{M}`, which is the predicate {@link fold} wants but the wrong one
 * here — the Brahmic scripts write many of their vowels as *spacing* combining
 * marks (Mc), and those are drawn beside the consonant rather than over it.
 * Treating `া` in `বাংলা` as weightless is what leaves the Bengali row of a
 * table one column short of every other.
 */
const ZERO_WIDTH = /[\p{Mn}\p{Me}]/u;

/** {@link String.padEnd}, measured in terminal columns rather than code units. */
export function padDisplay(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

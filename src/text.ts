/**
 * Shared, deterministic text analysis for every check that reasons about
 * *matching* — how a user's request lines up with a skill's description.
 *
 * Everything here is small, dependency-free and reproducible: the same input
 * always produces the same tokens on every machine, with no model and no
 * network. That property is what lets skillcheck's trigger checks run in CI.
 *
 * It is also, deliberately, not English-only. Segmentation is driven by Unicode
 * script (src/script.ts) and stopwords by a detected language pack
 * (src/languages/), so a description written in Japanese, Russian or Turkish
 * produces real terms instead of the empty set an ASCII tokenizer would leave
 * behind. What the checks then say about those terms is as true as what they
 * say about English ones — which is the whole point, because a skill that never
 * triggers fails the same way in every language.
 */

import { en } from "./languages/en.js";
import {
  detect,
  type LanguagePack,
  UNIVERSAL_STOPWORDS,
} from "./languages/index.js";
import { fold, isContinuous, isWordChar, type Script, scriptOf } from "./script.js";

export type { LanguagePack } from "./languages/index.js";

/**
 * English stopwords plus the universal domain noise.
 *
 * Retained as a named export because it is part of skillcheck's public API.
 * Internally, stopwords are resolved per detected language — a German
 * description must drop `war` ("was") while an English one keeps it as a noun,
 * and a single shared list cannot do both.
 */
export const STOPWORDS: ReadonlySet<string> = new Set([
  ...en.stopwords,
  ...UNIVERSAL_STOPWORDS,
]);

const DOUBLE_CONSONANT = /([bcdfghjklmnpqrstvwxz])\1$/;

/**
 * A deliberately small English stemmer (a trimmed Porter step 1): plurals plus
 * `-ing`/`-ed`, with Porter's `at|bl|iz` → `-e` restoration and doubled-consonant
 * collapse. It is an approximation, not linguistics — its only job is to make
 * "converting a PDF" match "converts PDFs". Both the request and the description
 * go through the identical function, so any imperfection applies symmetrically.
 *
 * Applied to Latin-script words only, where its `-s` rule also does honest work
 * for the Romance and Germanic plurals. Languages that need real morphology —
 * Russian cases, Turkish agglutination — are served instead by the parts of the
 * pipeline that don't need it: folding, and n-grams for the scripts that can't
 * be split on whitespace at all.
 */
export function stem(word: string): string {
  if (word.length <= 3) return word;

  // Plurals.
  if (/(?:ches|shes|sses|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (/ies$/.test(word) && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/[^su]s$/.test(word)) return word.slice(0, -1);

  // Gerund / past tense, only when a real stem is left behind — so "string"
  // stays "string" instead of collapsing to "str".
  if (/ing$/.test(word) && word.length >= 7) return restore(word.slice(0, -3));
  if (/ed$/.test(word) && word.length >= 6) return restore(word.slice(0, -2));

  return word;
}

/** Porter's step-1b tidy-up: `generat` → `generate`, `runn` → `run`. */
function restore(base: string): string {
  if (/(?:at|bl|iz)$/.test(base)) return `${base}e`;
  if (DOUBLE_CONSONANT.test(base)) return base.slice(0, -1);
  return base;
}

// ─────────────────────────────────────────────────────────────── runs ────────

interface Run {
  text: string;
  script: Script;
}

/**
 * Split text into maximal same-script word runs.
 *
 * Two things make this more than a regex. Non-word characters end a run, which
 * is ordinary. But so does a change of script — and that boundary is doing real
 * linguistic work for free in Japanese, where content sits in kanji and grammar
 * in kana: `PDFを作成` falls apart into `pdf`, `を` and `作成` without anything
 * in the pipeline knowing a word from a particle.
 *
 * Characters belonging to no script in particular — digits, combining marks —
 * join whatever run they land in rather than splitting it, so `pdf2md` and
 * `ISO8601` survive as single terms.
 */
function runsOf(text: string): Run[] {
  const runs: Run[] = [];
  let current = "";
  let script: Script = "common";

  const flush = () => {
    if (current) runs.push({ text: current, script });
    current = "";
    script = "common";
  };

  for (const char of text) {
    const cp = char.codePointAt(0)!;
    if (!isWordChar(cp)) {
      flush();
      continue;
    }
    const charScript = scriptOf(cp);
    if (charScript === "common") {
      current += char;
      continue;
    }
    if (current && script !== "common" && script !== charScript) flush();
    if (!current || script === "common") script = charScript;
    current += char;
  }
  flush();
  return runs;
}

/**
 * Overlapping character bigrams, the fallback for scripts written without
 * spaces between words.
 *
 * Segmenting Chinese, Japanese, Thai or Khmer properly takes a dictionary, and
 * shipping one would cost megabytes and the offline guarantee that lets
 * skillcheck run on a fork's pull request with no credentials. Bigrams are the
 * standard alternative — Lucene's CJK analyzer has used them for two decades —
 * and they hold up here for the specific reason that both sides of every
 * comparison go through them: `報告書` and a request mentioning `報告` share
 * `報告` whatever the true word boundaries were.
 *
 * A run of one character is emitted whole. In Han a single character is often a
 * whole word, and in Japanese the script split leaves particles stranded alone,
 * where the stopword list is waiting for them.
 */
function bigrams(run: string): string[] {
  const chars = [...run];
  if (chars.length === 1) return [chars[0]];
  const out: string[] = [];
  for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1]);
  return out;
}

// ────────────────────────────────────────────────────────── stopwords ────────

const EFFECTIVE_STOPWORDS = new Map<string, ReadonlySet<string>>();

/**
 * The stopword set to apply to a text in `pack`'s language.
 *
 * English is folded in for every non-Latin language on purpose. A Japanese or
 * Russian description still carries its technical prose in Latin runs —
 * "Markdown to PDF", "when the user asks" — and English function words can
 * collide with nothing in kana or Cyrillic, so including them is free. The
 * reverse would not be safe, which is why the Latin-script packs get only their
 * own list: German `war`, Dutch `die` and Indonesian `dan` are all ordinary
 * English content words, and a merged list would make every skill mentioning
 * them unfindable.
 */
function effectiveStopwords(pack: LanguagePack | null): ReadonlySet<string> {
  const key = pack?.code ?? "";
  const cached = EFFECTIVE_STOPWORDS.get(key);
  if (cached) return cached;

  const merged = new Set<string>(UNIVERSAL_STOPWORDS);
  if (pack) for (const word of pack.stopwords) merged.add(word);
  if (!pack || !pack.scripts.includes("latin")) {
    for (const word of en.stopwords) merged.add(word);
  }
  EFFECTIVE_STOPWORDS.set(key, merged);
  return merged;
}

// ────────────────────────────────────────────────────────── tokenizing ──────

/**
 * Split text into content terms: folded, script-segmented, stopwords removed,
 * Latin words stemmed. Duplicates are preserved — callers that want term
 * *frequency* (BM25) need them; {@link termSet} is the deduplicated view.
 *
 * Pass `pack` when the language is already known — a skill's `name` and
 * `when_to_use` should be read in the language its *description* is written in,
 * not re-detected from three words of English-looking slug. Omit it and the
 * language is detected from `text` itself.
 */
export function tokenize(text: string, pack?: LanguagePack | null): string[] {
  const language = pack === undefined ? detect(text).pack : pack;
  const stopwords = effectiveStopwords(language);
  const out: string[] = [];

  for (const run of runsOf(fold(text))) {
    if (isContinuous(run.script)) {
      for (const gram of bigrams(run.text)) {
        if (!stopwords.has(gram)) out.push(gram);
      }
      continue;
    }
    if (run.text.length < 2) continue;
    if (stopwords.has(run.text)) continue;
    const term = run.script === "latin" ? stem(run.text) : run.text;
    // Re-check after stemming: "uses" → "use" is still a stopword.
    if (term.length < 2 || stopwords.has(term)) continue;
    out.push(term);
  }
  return out;
}

/** The distinct content terms in `text`. */
export function termSet(text: string, pack?: LanguagePack | null): Set<string> {
  return new Set(tokenize(text, pack));
}

/** Sørensen–Dice coefficient over two term sets. 0 when either side is empty. */
export function dice(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let overlap = 0;
  for (const term of small) if (large.has(term)) overlap++;
  return (2 * overlap) / (a.size + b.size);
}

/**
 * How many words of prose `text` contains, counted in a way that works outside
 * the Latin alphabet.
 *
 * Spaced scripts are counted by runs. Scripts written without spaces are
 * counted by characters and divided — two characters to a word is the
 * conventional average for Han and Kana, and near enough for the only question
 * anyone asks of this number: is there anything here at all, or is the body a
 * heading and nothing else?
 */
export function countWords(text: string): number {
  let words = 0;
  let continuousChars = 0;
  for (const run of runsOf(fold(text))) {
    if (isContinuous(run.script)) continuousChars += [...run.text].length;
    else words++;
  }
  return words + Math.round(continuousChars / 2);
}

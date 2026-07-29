import { type Script, scriptOf } from "./script.js";

/**
 * Deterministic, offline token estimate.
 *
 * skillcheck never calls a model API, so this is a heuristic — but it is a
 * *script-aware* one, because the usual "~4 characters per token" rule of thumb
 * is only true of English. Modern BPE vocabularies are trained mostly on Latin
 * text, so everything else pays more per character: a Han character is roughly
 * a token by itself, and a Cyrillic or Arabic word costs two or three tokens
 * where its English translation costs one.
 *
 * That gap is not cosmetic. A 12,000-character Japanese SKILL.md priced at four
 * characters per token looks like 3,000 tokens and comfortably inside the
 * spec's budget, while actually costing something closer to 12,000 — paid on
 * every activation, in every session. Under the old estimate skillcheck told
 * the author their skill was fine. It was not.
 *
 * Ratios are conservative round numbers, not a claim to match any particular
 * tokenizer; every message that surfaces the result labels it an estimate.
 * Exact counting against a live tokenizer is planned as an opt-in
 * (`--tokens=api`) so the default stays credential-free and CI-safe.
 */

/** Characters per token, by script. Lower means more expensive. */
const CHARS_PER_TOKEN: Readonly<Record<Script, number>> = {
  // Latin BPE vocabularies merge whole words and common suffixes.
  latin: 4,
  common: 3.5,
  // Alphabets that are usually two UTF-8 bytes per character and rarely merged
  // beyond short subwords.
  cyrillic: 2,
  greek: 2,
  hebrew: 2,
  armenian: 2,
  georgian: 2,
  arabic: 2,
  // Three-byte scripts, split near the character.
  devanagari: 1.5,
  brahmic: 1.5,
  ethiopic: 1.5,
  thai: 1.5,
  lao: 1.5,
  khmer: 1.5,
  myanmar: 1.5,
  // A CJK character is a token, give or take.
  han: 1,
  kana: 1.2,
  hangul: 1.2,
};

/**
 * Estimated tokens in `text`, summing each script's characters at its own rate.
 *
 * Whitespace and punctuation are counted as `common` rather than dropped: they
 * are not free, and in Latin prose they are a large part of what the merges are
 * made of.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  for (const char of text) {
    tokens += 1 / CHARS_PER_TOKEN[scriptOf(char.codePointAt(0)!)];
  }
  return Math.ceil(tokens);
}

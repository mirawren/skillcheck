import { basename } from "node:path";
import {
  describeLanguage,
  detect,
  type Detection,
  type LanguagePack,
  packFor,
} from "./languages/index.js";
import { termSet, tokenize } from "./text.js";
import type { SkillDoc } from "./types.js";

/**
 * Trigger simulation — a deterministic, offline model of skill selection.
 *
 * A host shows the model one line per installed skill (its `name` and
 * `description`) and the model picks from that list. skillcheck can't run the
 * model in CI, so it runs the *retrieval* half of that decision instead: a
 * standard BM25 ranking of every skill's name + description against a request.
 *
 * What this is good for, honestly:
 *   - **Ambiguity.** When two skills score within a hair of each other, no
 *     selection strategy — lexical or neural — can be relied on to break the
 *     tie the way you intended. That signal transfers.
 *   - **Regression.** The ranking is a pure function of your text, so a
 *     scenario that flips after an edit means *you changed the text that
 *     decides*. Deterministic, reviewable, diffable.
 *
 * What it is NOT: a prediction of what Claude (or any model) will actually do.
 * A model reads meaning; BM25 counts words. Treat a "clear" verdict as
 * "nothing in the wording is working against you", never as a guarantee.
 * Model-in-the-loop evaluation is a different, complementary tool.
 */

/** BM25 term-saturation and length-normalization constants (Lucene defaults). */
const K1 = 1.2;
const B = 0.75;

/** `name` is shown to the model alongside the description, so it counts twice. */
const NAME_WEIGHT = 2;

/** Below this share of the request's terms, the top skill isn't really a match. */
export const MIN_COVERAGE = 0.34;

/** Relative gap under which first and second place are a coin flip. */
export const CLOSE_MARGIN = 0.15;

export interface IndexedSkill {
  doc: SkillDoc;
  file: string;
  /** The skill's `name`, falling back to its folder name. */
  name: string;
  /** Weighted term frequencies across name + description + `when_to_use`. */
  tf: Map<string, number>;
  /** Total weighted term count — BM25's document length. */
  length: number;
  /** Description-only terms, for the pairwise similarity check. */
  descTerms: Set<string>;
  /** The language its description is written in, detected once and reused. */
  language: Detection;
}

export interface TriggerIndex {
  skills: IndexedSkill[];
  /** term → indices into `skills` (an inverted index, so scoring skips misses). */
  postings: Map<string, number[]>;
  /** Absolute path → its indexed skill. */
  byFile: Map<string, IndexedSkill>;
  /** Absolute path → its position in `skills`. */
  positionOf: Map<string, number>;
  avgLength: number;
}

export interface TriggerMatch {
  file: string;
  name: string;
  /** Raw BM25 score. Comparable within one report, not across repos. */
  score: number;
  /** This skill's share of all matched score, 0–1 — the display number. */
  share: number;
  /** Request terms this skill matched, in request order. */
  matched: string[];
}

export type Verdict = "clear" | "close" | "none";

export interface TriggerReport {
  prompt: string;
  /** Content terms extracted from the request (stemmed). */
  terms: string[];
  /** Every skill that matched at least one term, best first. */
  matches: TriggerMatch[];
  /** `(top − second) / top`, or 1 when only one skill matched. */
  margin: number;
  /** Share of request terms the top skill matched, 0–1. */
  coverage: number;
  verdict: Verdict;
  /** The language the request itself is written in. */
  language: Detection;
  /**
   * Skills written in a *different* language from the request that this ranking
   * therefore says nothing about — reported so an empty result in a
   * multilingual repo reads as "asked in the wrong language" rather than "no
   * skill covers this". See the `cross-language-trigger` rule.
   */
  outOfLanguage: OutOfLanguage[];
}

export interface OutOfLanguage {
  /** Language code, or `"?"` when the skill's language has no pack. */
  code: string;
  /** Display label, e.g. `Japanese (日本語)`. */
  label: string;
  /** How many skills in the repo are described in it. */
  count: number;
}

/**
 * Which language a skill is written in.
 *
 * Detected from the `description`, because that is the longest and most
 * natural prose a skill has — a `name` is a slug and a body is full of code.
 * An author who knows better can say so outright in frontmatter:
 *
 * ```yaml
 * x-skillcheck:
 *   lang: ja
 * ```
 *
 * which matters for the short, technical, loanword-heavy descriptions where
 * detection has the least to go on and is most likely to guess English.
 */
export function languageOf(doc: SkillDoc): Detection {
  const declared = declaredLanguage(doc);
  if (declared) return { pack: declared, confidence: 1, script: declared.scripts[0] };
  return detect(doc.description ?? "");
}

function declaredLanguage(doc: SkillDoc): LanguagePack | null {
  const raw = doc.frontmatter?.["x-skillcheck"];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const lang = (raw as Record<string, unknown>).lang;
  return typeof lang === "string" ? (packFor(lang) ?? null) : null;
}

function indexOne(doc: SkillDoc): IndexedSkill {
  const name = doc.name ?? basename(doc.dir);
  const description = doc.description ?? "";
  const whenToUse =
    typeof doc.frontmatter?.when_to_use === "string" ? doc.frontmatter.when_to_use : "";

  // One detection per skill, from the description, reused for every field. A
  // `name` is a kebab slug and `when_to_use` is often a fragment; re-detecting
  // from either would read them as English and drop the wrong stopwords.
  const language = languageOf(doc);

  const tf = new Map<string, number>();
  const add = (text: string, weight: number) => {
    for (const term of tokenize(text, language.pack)) tf.set(term, (tf.get(term) ?? 0) + weight);
  };
  add(name, NAME_WEIGHT);
  add(description, 1);
  add(whenToUse, 1);

  let length = 0;
  for (const count of tf.values()) length += count;

  return {
    doc,
    file: doc.file,
    name,
    tf,
    length,
    descTerms: termSet(description, language.pack),
    language,
  };
}

/** Build the retrieval index over a set of skills. Pure and order-stable. */
export function buildIndex(skills: readonly SkillDoc[]): TriggerIndex {
  const indexed = skills.map(indexOne);
  const postings = new Map<string, number[]>();
  const byFile = new Map<string, IndexedSkill>();
  const positionOf = new Map<string, number>();
  let total = 0;
  indexed.forEach((skill, i) => {
    total += skill.length;
    byFile.set(skill.file, skill);
    positionOf.set(skill.file, i);
    for (const term of skill.tf.keys()) {
      const list = postings.get(term);
      if (list) list.push(i);
      else postings.set(term, [i]);
    }
  });
  return {
    skills: indexed,
    postings,
    byFile,
    positionOf,
    avgLength: indexed.length ? total / indexed.length : 1,
  };
}

/**
 * Cache the index per skill-set, keyed on the array identity a single check run
 * shares. Rules get the index for free instead of re-tokenizing per pair, which
 * is what keeps the cross-skill checks linear-ish instead of quadratic.
 */
const indexCache = new WeakMap<readonly SkillDoc[], TriggerIndex>();

export function indexFor(skills: readonly SkillDoc[]): TriggerIndex {
  let index = indexCache.get(skills);
  if (!index) {
    index = buildIndex(skills);
    indexCache.set(skills, index);
  }
  return index;
}

/**
 * Inverse document frequency, Lucene's `log(1 + (N − df + 0.5)/(df + 0.5))`
 * variant. Chosen over textbook BM25 specifically because it stays positive at
 * tiny N: most repos hold 2–5 skills, and the classic formula goes negative (or
 * exactly zero) for a term present in half of them, which would silently zero
 * out the only signal there is.
 */
export function idf(index: TriggerIndex, term: string): number {
  const df = index.postings.get(term)?.length ?? 0;
  const n = index.skills.length;
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

/** BM25 contribution of one term to one skill. */
function termScore(index: TriggerIndex, skill: IndexedSkill, term: string): number {
  const tf = skill.tf.get(term);
  if (!tf) return 0;
  const norm = 1 - B + (B * skill.length) / (index.avgLength || 1);
  return idf(index, term) * ((tf * (K1 + 1)) / (tf + K1 * norm));
}

/**
 * Rank every skill against a request. Repeated terms in the request count once:
 * requests are short, and letting a repeated word compound would reward
 * keyword-stuffed prompts rather than measuring the skill.
 */
export function rank(index: TriggerIndex, prompt: string): TriggerMatch[] {
  return rankTerms(index, uniqueTerms(prompt));
}

/** {@link rank} for terms that are already tokenized and deduplicated. */
export function rankTerms(index: TriggerIndex, terms: readonly string[]): TriggerMatch[] {
  const scores = new Map<number, { score: number; matched: string[] }>();

  for (const term of terms) {
    for (const i of index.postings.get(term) ?? []) {
      const contribution = termScore(index, index.skills[i], term);
      if (contribution <= 0) continue;
      const entry = scores.get(i) ?? { score: 0, matched: [] };
      entry.score += contribution;
      entry.matched.push(term);
      scores.set(i, entry);
    }
  }

  let total = 0;
  for (const { score } of scores.values()) total += score;

  return [...scores.entries()]
    .map(([i, { score, matched }]) => ({
      file: index.skills[i].file,
      name: index.skills[i].name,
      score,
      share: total > 0 ? score / total : 0,
      matched,
    }))
    // Deterministic ordering: score, then name, then path.
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.file.localeCompare(b.file));
}

/** Distinct, stemmed content terms in a request, in first-seen order. */
export function uniqueTerms(prompt: string): string[] {
  return [...new Set(tokenize(prompt))];
}

/**
 * Rank a request and judge the outcome:
 *   `none`  — nothing matched enough of the request to be a real candidate
 *   `close` — first and second place are within {@link CLOSE_MARGIN}: a coin flip
 *   `clear` — one skill wins by a readable margin
 */
export function matchPrompt(index: TriggerIndex, prompt: string): TriggerReport {
  const language = detect(prompt);
  const terms = uniqueTerms(prompt);
  const matches = rank(index, prompt);
  const top = matches[0];
  const second = matches[1];

  const coverage = top && terms.length ? top.matched.length / terms.length : 0;
  const margin = top && second ? (top.score - second.score) / top.score : top ? 1 : 0;

  let verdict: Verdict = "clear";
  if (!top || terms.length === 0 || coverage < MIN_COVERAGE) verdict = "none";
  else if (second && margin < CLOSE_MARGIN) verdict = "close";

  return {
    prompt,
    terms,
    matches,
    margin,
    coverage,
    verdict,
    language,
    outOfLanguage: outOfLanguage(index, language),
  };
}

/**
 * Languages other than the request's that skills in this repo are described in.
 *
 * A request only reaches a description through shared terms, and two languages
 * share almost nothing but product names. So when a ranking comes back thin,
 * the useful question is often not "is my wording bad?" but "are the skills
 * that would have answered this written in another language?" — a question no
 * amount of staring at the ranking can answer, and one that never comes up
 * until a repo has contributors from more than one country.
 */
function outOfLanguage(index: TriggerIndex, request: Detection): OutOfLanguage[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const skill of index.skills) {
    const code = skill.language.pack?.code ?? "?";
    if (code === (request.pack?.code ?? "?")) continue;
    const entry = counts.get(code) ?? { label: describeLanguage(skill.language), count: 0 };
    entry.count++;
    counts.set(code, entry);
  }
  return [...counts]
    .map(([code, { label, count }]) => ({ code, label, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

/**
 * The words that make a skill findable: its **description** terms, rarest
 * first.
 *
 * Description only, deliberately. A skill's `name` terms are unique to it
 * almost by definition ("changelog-writer" contains "writer", nobody else
 * does), so including them would make any question of the form "does another
 * skill cover this one's vocabulary?" answer no every time — the check would
 * look like it worked and never fire.
 */
export function distinctiveTerms(index: TriggerIndex, skill: IndexedSkill, limit = 6): string[] {
  return [...skill.descTerms]
    .map((term) => ({ term, weight: idf(index, term) }))
    .sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term))
    .slice(0, limit)
    .map((t) => t.term);
}

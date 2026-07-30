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

/**
 * Below this share of the request's *matchable* terms, the top skill isn't
 * really a match.
 *
 * "Matchable" is load-bearing — see {@link matchPrompt}. Measured against every
 * term instead, this threshold reported a sole, unambiguous winner as "no skill
 * covers this request": ask "help me set up a new webhook" of a repo whose
 * webhook skill is the only candidate, and `help`, `set` and `new` — words no
 * description contains, and none ever will — outvoted the one word that decided
 * the ranking. The more naturally a request was phrased, the more likely the
 * failure, which is the exact opposite of the advice in docs/trigger-simulation.md.
 */
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
  /**
   * Σ idf over {@link descTerms} — how much *distinguishing* vocabulary this
   * description holds, as opposed to how many words.
   *
   * Precomputed here rather than in the similarity rule because idf needs the
   * finished postings map, and the rule would otherwise recompute it per
   * candidate pair: quadratic in the corpus, on the one code path a marketplace
   * repo exercises hardest.
   */
  descWeight: number;
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
  /**
   * The top skill plus every skill within {@link CLOSE_MARGIN} of it — the set
   * that is genuinely competing for this request.
   *
   * `margin` compares first place to second, which is the right question when
   * two skills collide and the wrong one when several do: a ten-way tie reports
   * a 0% gap between the arbitrary two that sorted highest, and says nothing
   * about the other eight. Reporting the block is what makes a real collision in
   * a large repo legible instead of merely detected.
   */
  contenders: TriggerMatch[];
  /** `(top − second) / top`, or 1 when only one skill matched. */
  margin: number;
  /**
   * Share of the request's *matchable* terms the top skill matched, 0–1 — where
   * matchable means "occurs in at least one skill in this repo". See
   * {@link matchPrompt}.
   */
  coverage: number;
  /**
   * Request terms no skill in the repo contains, so nothing could have matched
   * them. Reported because they are the honest answer to "why is my whole
   * sentence not in the terms list?".
   */
  unmatchable: string[];
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
    // Filled in by buildIndex, once idf is answerable.
    descWeight: 0,
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
  const index: TriggerIndex = {
    skills: indexed,
    postings,
    byFile,
    positionOf,
    avgLength: indexed.length ? total / indexed.length : 1,
  };

  // idf needs the finished postings map, so the description weights are a second
  // pass. One pass over every description term in the corpus — linear, once.
  for (const skill of indexed) {
    let weight = 0;
    for (const term of skill.descTerms) weight += idf(index, term);
    skill.descWeight = weight;
  }

  return index;
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

  /**
   * Coverage is measured over the terms that *could* have matched — the ones
   * occurring in at least one skill here — rather than over every content word
   * in the request.
   *
   * A real request is mostly words no description will ever contain: "help me",
   * "set up", "quick", "again". Counting those against the winner made coverage
   * a measure of how conversationally the question was asked, and pushed
   * correctly-answered requests into the `none` verdict — where `skillcheck test`
   * fails a build with "nothing matched the request" about a skill that is
   * plainly the answer and won 100% of the score. Dividing by what was
   * answerable makes the number mean what it says: *of the request this repo
   * could speak to, how much did the winner take?*
   */
  const unmatchable = terms.filter((term) => !index.postings.has(term));
  const matchable = terms.length - unmatchable.length;
  const coverage = top && matchable > 0 ? top.matched.length / matchable : 0;
  const margin = top && second ? (top.score - second.score) / top.score : top ? 1 : 0;

  const contenders = top
    ? matches.filter((m) => (top.score - m.score) / top.score < CLOSE_MARGIN)
    : [];

  let verdict: Verdict = "clear";
  if (!top || matchable === 0 || coverage < MIN_COVERAGE) verdict = "none";
  else if (contenders.length > 1) verdict = "close";

  return {
    prompt,
    terms,
    matches,
    contenders,
    margin,
    coverage,
    unmatchable,
    verdict,
    language,
    outOfLanguage: outOfLanguage(index, language),
  };
}

/**
 * What a set of contenders agree on, and what separates them.
 *
 * A coin-flip verdict names the problem and stops one sentence short of an
 * action: the author is told two skills tie at 7% and left to guess which word
 * caused it. These two sets are the answer, and both are facts rather than
 * advice — the shared terms are why the tie exists, and a contender's own terms
 * are the vocabulary it already holds alone. An empty "only" list is the most
 * useful output of all: it says this skill has nothing of its own, so no
 * rewording will separate them and one of them should not exist.
 *
 * Rarest first, because a term two skills share that nothing else in the repo
 * uses is doing more to bind them together than a term everybody has.
 */
export function contenderTerms(
  index: TriggerIndex,
  contenders: readonly TriggerMatch[],
): { shared: string[]; only: Map<string, string[]> } {
  // Keyed by file, not name. Two skills can share a `name` — the same skill
  // vendored into two plugins is precisely the coin flip this explains — and a
  // name-keyed map would silently drop one of them.
  const sets = contenders.map((m) => index.byFile.get(m.file)?.descTerms ?? new Set<string>());
  const byIdf = (a: string, b: string) => idf(index, b) - idf(index, a) || a.localeCompare(b);

  const shared = [...(sets[0] ?? [])]
    .filter((term) => sets.every((set) => set.has(term)))
    .sort(byIdf);

  const only = new Map<string, string[]>();
  contenders.forEach((match, i) => {
    only.set(
      match.file,
      [...sets[i]].filter((term) => sets.every((set, j) => j === i || !set.has(term))).sort(byIdf),
    );
  });

  return { shared, only };
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

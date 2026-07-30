import { numberOption } from "../config.js";
import { idf, indexFor } from "../match.js";
import { displayPath } from "../paths.js";
import type { Finding, Rule } from "../types.js";

const DEFAULT_WARN_AT = 0.5;
const DEFAULT_ERROR_AT = 0.7;

/**
 * Below this many skills, overlap is measured as a plain term ratio.
 *
 * Rarity weighting works by noticing that a word appearing in most descriptions
 * carries no information. That inference needs a corpus. With two or three
 * skills, *every* shared term appears in most of them by arithmetic — a shared
 * topic word and a line of shared boilerplate are indistinguishable — so the
 * weighting has nothing to discount and instead discounts the evidence. Measured:
 * two genuinely near-duplicate skills alone in a repo scored 0.34 weighted
 * against 0.80 unweighted, which would have quietly stopped reporting the most
 * common shape of this failure there is: someone's first two skills.
 *
 * So the weighting applies only where its premise holds. The honest cost is that
 * a three-skill repo whose skills all share one template can still be reported;
 * the alternative is missing real duplicates in every small repo, which is worse
 * and much more common.
 */
const MIN_CORPUS_FOR_WEIGHTING = 4;

/**
 * Cross-skill rule: two skills whose descriptions look alike compete for the
 * same requests, and the tie gets broken arbitrarily — the classic "my skill
 * stopped triggering after I added a second one" failure.
 *
 * Three implementation decisions, all learned from running this over real
 * corpora:
 *
 * 1. **Overlap is weighted by how rare each shared term is** (Σ idf, not a raw
 *    term count). This was the tool's largest false positive, at error severity.
 *    Ten skills about pdf, kubernetes, stripe, figma and six other unrelated
 *    technologies, each written to one house template — *"Automates X operations
 *    for this repository. Use when the user asks to inspect, configure or
 *    troubleshoot X."* — every one of them reported as 88% similar and unable to
 *    be told apart, ten errors, grade C, build failed. Meanwhile skillcheck's own
 *    ranking gave `troubleshoot my kubernetes ingress` to kubernetes by 89% over
 *    1%. Two subsystems in one binary reaching opposite verdicts about identical
 *    text, and the one that failed the build was the wrong one.
 *
 *    Six words of shared boilerplate are not evidence of a collision; one shared
 *    *topic* word is. Weighting by idf says exactly that, and it says it using
 *    the same numbers the ranking already uses, so the two can no longer
 *    disagree.
 *
 * 2. **One finding per skill, not per pair.** Reporting every colliding pair is
 *    quadratic in the *output*: a marketplace repo full of near-identical
 *    skills produced half a million findings, which is not a report anyone can
 *    read. Each skill reports its single worst collision and counts the rest, so
 *    the output grows with the number of skills, not their square.
 *
 * 3. **Overlaps come from the inverted index**, accumulated term by term, instead
 *    of intersecting every pair of skills. Skills that share no description word
 *    are never compared at all.
 */
export const descriptionSimilarity: Rule = {
  id: "description-similarity",
  summary: "no two skills have near-identical descriptions (trigger ambiguity)",
  docs: {
    why: "The model chooses between skills using their descriptions alone. When two of them are worded almost the same, the choice comes down to tie-breaking you don't control, and the skill you meant to fire wins roughly half the time. This is the most common regression when a repo grows from one skill to several.",
    bad: `# skills/grill-me/SKILL.md
description: Reviews your code changes for bugs, style issues and missed edge cases before you commit.

# skills/review-me/SKILL.md
description: Reviews your code changes for bugs, style problems and missed edge cases before committing.`,
    good: `# skills/grill-me/SKILL.md
description: Adversarial deep review of a diff. Use when the user explicitly asks to be challenged, or wants a security-focused "poke holes in this" pass.

# skills/review-me/SKILL.md
description: Routine pre-commit review of staged changes for style and obvious bugs. Use before every commit unless the user asks for a deeper pass.`,
  },
  options: [
    {
      name: "warnAt",
      type: "number",
      default: DEFAULT_WARN_AT,
      description:
        "Rarity-weighted overlap at which a pair is reported as a warning. Shared words count for as much as they are rare in this repo, so boilerplate barely moves it.",
    },
    {
      name: "errorAt",
      type: "number",
      default: DEFAULT_ERROR_AT,
      description: "Rarity-weighted overlap at which a pair becomes an error.",
    },
  ],
  check(doc, ctx) {
    if (!doc.description) return [];
    const opts = ctx.options[this.id];
    const warnAt = numberOption(opts, "warnAt", DEFAULT_WARN_AT);
    const errorAt = numberOption(opts, "errorAt", DEFAULT_ERROR_AT);

    const index = indexFor(ctx.skills);
    const self = index.byFile.get(doc.file);
    const position = index.positionOf.get(doc.file);
    if (!self || position === undefined || self.descTerms.size === 0) return [];

    const weighted = index.skills.length >= MIN_CORPUS_FOR_WEIGHTING;

    // Shared description weight, accumulated straight off the posting lists —
    // no per-pair set intersection, no Map churn.
    const shared = new Float64Array(index.skills.length);
    for (const term of self.descTerms) {
      const postings = index.postings.get(term);
      if (!postings) continue;
      const weight = weighted ? idf(index, term) : 1;
      for (const i of postings) {
        if (index.skills[i].descTerms.has(term)) shared[i] += weight;
      }
    }

    const totalFor = (skill: (typeof index.skills)[number]) =>
      weighted ? skill.descWeight : skill.descTerms.size;

    let worst: { skill: (typeof index.skills)[number]; score: number } | null = null;
    let colliding = 0;
    for (let i = 0; i < shared.length; i++) {
      if (shared[i] === 0 || i === position) continue;
      const other = index.skills[i];
      const denominator = totalFor(self) + totalFor(other);
      if (denominator === 0) continue;
      const score = (2 * shared[i]) / denominator;
      if (score < warnAt) continue;
      colliding++;
      // Deterministic pick: highest score, then lowest path.
      if (!worst || score > worst.score || (score === worst.score && other.file < worst.skill.file)) {
        worst = { skill: other, score };
      }
    }
    if (!worst) return [];

    const others = colliding - 1;
    const pct = Math.round(worst.score * 100);
    const alsoOthers = others > 0 ? ` (and ${others} other skill${others === 1 ? "" : "s"})` : "";

    /**
     * The terms doing the colliding, rarest first.
     *
     * The old message gave a percentage and a filename and left the author to
     * diff two sentences by eye. These are the actual words the finding is about
     * — and now that overlap is idf-weighted, they are the words that carry the
     * weight rather than whichever boilerplate happened to be shared.
     */
    const overlap = [...self.descTerms]
      .filter((term) => worst!.skill.descTerms.has(term))
      .sort((a, b) => idf(index, b) - idf(index, a) || a.localeCompare(b))
      .slice(0, 5);

    return [
      {
        ruleId: this.id,
        severity: worst.score >= errorAt ? "error" : "warning",
        message:
          `description is ${pct}% similar to ${displayPath(worst.skill.file)}${alsoOthers} on: ` +
          `${overlap.join(", ")} — the model can't reliably tell them apart`,
        file: doc.file,
        line: 1,
        detail:
          "Overlapping descriptions make triggering a coin flip between the two skills. Overlap is weighted by how rare each shared word is in this repo, so the words named above are the ones actually binding the two together — shared boilerplate counts for almost nothing. Sharpen each description around the situations only IT covers, or merge the skills.",
      },
    ];
  },
};

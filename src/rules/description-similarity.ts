import { numberOption } from "../config.js";
import { indexFor } from "../match.js";
import { displayPath } from "../paths.js";
import type { Finding, Rule } from "../types.js";

const DEFAULT_WARN_AT = 0.55;
const DEFAULT_ERROR_AT = 0.75;

/**
 * Cross-skill rule: two skills whose descriptions look alike compete for the
 * same requests, and the tie gets broken arbitrarily — the classic "my skill
 * stopped triggering after I added a second one" failure.
 *
 * Two implementation decisions, both learned from running this over a
 * thousand-skill corpus:
 *
 * 1. **One finding per skill, not per pair.** Reporting every colliding pair is
 *    quadratic in the *output*: a marketplace repo full of near-identical
 *    skills produced half a million findings, which is not a report anyone can
 *    read. Each skill now reports its single worst collision and counts the
 *    rest, so the output grows with the number of skills, not their square.
 * 2. **Overlaps come from the inverted index**, counted term by term, instead of
 *    intersecting every pair of skills. Skills that share no description word
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
      description: "Dice coefficient at which a pair is reported as a warning.",
    },
    {
      name: "errorAt",
      type: "number",
      default: DEFAULT_ERROR_AT,
      description: "Dice coefficient at which a pair becomes an error.",
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

    // Shared description terms, counted straight off the posting lists into a
    // typed accumulator — no per-pair set intersection, no Map churn.
    const shared = new Int32Array(index.skills.length);
    for (const term of self.descTerms) {
      const postings = index.postings.get(term);
      if (!postings) continue;
      for (const i of postings) {
        if (index.skills[i].descTerms.has(term)) shared[i]++;
      }
    }

    let worst: { file: string; score: number } | null = null;
    let colliding = 0;
    for (let i = 0; i < shared.length; i++) {
      if (shared[i] === 0 || i === position) continue;
      const other = index.skills[i];
      const score = (2 * shared[i]) / (self.descTerms.size + other.descTerms.size);
      if (score < warnAt) continue;
      colliding++;
      // Deterministic pick: highest score, then lowest path.
      if (!worst || score > worst.score || (score === worst.score && other.file < worst.file)) {
        worst = { file: other.file, score };
      }
    }
    if (!worst) return [];

    const others = colliding - 1;
    const pct = Math.round(worst.score * 100);
    const alsoOthers = others > 0 ? ` (and ${others} other skill${others === 1 ? "" : "s"})` : "";
    return [
      {
        ruleId: this.id,
        severity: worst.score >= errorAt ? "error" : "warning",
        message: `description is ${pct}% similar to ${displayPath(worst.file)}${alsoOthers} — the model can't reliably tell them apart`,
        file: doc.file,
        line: 1,
        detail:
          "Overlapping descriptions make triggering a coin flip between the two skills. Sharpen each description around the situations only IT covers, or merge the skills.",
      },
    ];
  },
};

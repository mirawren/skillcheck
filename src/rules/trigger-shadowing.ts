import { numberOption } from "../config.js";
import { distinctiveTerms, indexFor, type TriggerIndex } from "../match.js";
import { displayPath } from "../paths.js";
import type { Finding, Rule } from "../types.js";

/** How many of a skill's own defining terms have to be covered. */
const TERM_COUNT = 6;
/** Below this many distinctive terms there isn't enough signal to judge. */
const DEFAULT_MIN_TERMS = 4;

/**
 * Asymmetric sibling of `description-similarity`.
 *
 * Similarity asks "do these two look alike?" — a symmetric, whole-text
 * question. Shadowing asks the sharper one: does some *broader* skill already
 * contain every word that makes this skill findable? When it does, there is no
 * request phrased in this skill's own vocabulary that doesn't also describe the
 * other one, and the tie is resolved by something you don't control.
 *
 * This is the failure that appears when a repo adds one catch-all skill beside
 * its specific ones. Nothing in a per-file lint can see it, and the two
 * descriptions needn't look alike at all — which is exactly why the similarity
 * check misses it.
 *
 * Deliberately conservative: it fires only when the other skill's description
 * covers *all* of this skill's distinctive terms AND has a broader vocabulary
 * overall. Two skills that merely resemble each other are similarity's job, and
 * reporting them twice would train people to ignore both.
 */
export const triggerShadowing: Rule = {
  id: "trigger-shadowing",
  summary: "no broader skill already covers this skill's own defining words",
  docs: {
    why: "A skill is shadowed when a broader sibling's description already contains every distinctive word of its own. Requests phrased in this skill's vocabulary describe the other one just as well, so which of them fires is arbitrary — the specific skill is installed, valid, and unreachable. Adding one catch-all skill next to specific ones is the usual cause.",
    bad: `# skills/changelog-writer/SKILL.md
description: Writes a changelog from git history. Use when the user asks for a changelog.

# skills/release-manager/SKILL.md   <- covers every word above, and more
description: Writes a changelog from git history, bumps the version, tags the release and publishes the package. Use when the user asks to cut a release.`,
    good: `# skills/changelog-writer/SKILL.md
description: Writes a changelog from git history. Use when the user asks for a changelog.

# skills/release-manager/SKILL.md   <- no longer claims changelog vocabulary
description: Bumps the version, tags it and publishes the package. Use when the user asks to cut a release; it delegates the notes to changelog-writer.`,
  },
  options: [
    {
      name: "minTerms",
      type: "number",
      default: DEFAULT_MIN_TERMS,
      description: "Distinctive terms a skill needs before shadowing is judged at all.",
    },
  ],
  check(doc, ctx): Finding[] {
    if (!doc.description || doc.parseError) return [];
    const index = indexFor(ctx.skills);
    if (index.skills.length < 2) return [];

    const self = index.byFile.get(doc.file);
    const position = index.positionOf.get(doc.file);
    if (!self || position === undefined) return [];

    const minTerms = numberOption(ctx.options[this.id], "minTerms", DEFAULT_MIN_TERMS);
    const terms = distinctiveTerms(index, self, TERM_COUNT);
    if (terms.length < minTerms) return [];

    const covering = skillsCoveringAll(index, terms, position);
    // Only a *broader* skill shadows: equal-sized twins are near-duplicates,
    // which `description-similarity` already reports from both sides.
    const shadow = covering
      .map((i) => index.skills[i])
      .filter((other) => other.tf.size > self.tf.size)
      .sort((a, b) => b.tf.size - a.tf.size || a.file.localeCompare(b.file))[0];
    if (!shadow) return [];

    return [
      {
        ruleId: this.id,
        severity: "warning",
        message: `shadowed by ${displayPath(shadow.file)} — its description already covers every distinctive word of this one (${terms.join(", ")})`,
        file: doc.file,
        line: 1,
        detail:
          'Any request worded around this skill reads as a request for the broader one too, so which fires is arbitrary. Narrow the broader skill to what it should own, or give this one vocabulary the other does not claim. `skillcheck why "<a request this skill should win>"` shows the ranking.',
      },
    ];
  },
};

/**
 * Indices of skills whose text contains every one of `terms`.
 *
 * Posting lists are intersected rarest-first, so the candidate set collapses on
 * the most selective term instead of sweeping the corpus — distinctive terms
 * are high-idf by construction, which means short lists.
 */
function skillsCoveringAll(index: TriggerIndex, terms: string[], exclude: number): number[] {
  const lists = terms
    .map((term) => index.postings.get(term) ?? [])
    .sort((a, b) => a.length - b.length);
  if (lists.length === 0 || lists[0].length === 0) return [];

  let candidates = lists[0].filter((i) => i !== exclude);
  for (let i = 1; i < lists.length && candidates.length > 0; i++) {
    const next = new Set(lists[i]);
    candidates = candidates.filter((candidate) => next.has(candidate));
  }
  return candidates;
}

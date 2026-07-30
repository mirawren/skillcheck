import { basename } from "node:path";
import { displayPath } from "./paths.js";
import { estimateTokens } from "./tokens.js";
import type { ContextDoc, SkillDoc } from "./types.js";

/**
 * What a repo's agent instructions cost before anyone asks for anything.
 *
 * Every other number skillcheck reports is about one file. This one is about
 * the shape of the whole repo, and it exists because the expensive half of that
 * shape is invisible from any single file:
 *
 *   - A skill's **body** is opt-in. It costs nothing until the model picks the
 *     skill, which is what `body-size` budgets.
 *   - A skill's **description** is not. The model cannot choose between skills
 *     without being shown all of them, so every description is in context on
 *     every request — including the forty belonging to skills that will never
 *     fire in this session.
 *   - An **AGENTS.md / CLAUDE.md** is not either. It is read at the start and
 *     carried for the rest of the session.
 *
 * So the cost of *having* a skill is its description, paid always, and the cost
 * of *using* one is its body, paid sometimes. Nothing in a per-file view
 * distinguishes those, and the first one is the one that grows without anybody
 * deciding to grow it.
 *
 * Hosts differ in exactly how they lay the list out, and prompt caching changes
 * what it costs in dollars — neither changes what it occupies in the context
 * window, which is what this measures.
 */

export interface BudgetLine {
  label: string;
  /** Absolute path, when the line is one file. */
  file?: string;
  tokens: number;
  /** Skills aggregated into this line, when it is an aggregate. */
  count?: number;
}

export interface BudgetReport {
  /** Loaded before the user's first word, in every session. */
  always: BudgetLine[];
  alwaysTotal: number;
  /** Context files below a scanned root: read only while working in their directory. */
  nested: BudgetLine[];
  /** What each skill adds when it fires, largest first. */
  onActivation: BudgetLine[];
  /** Per-skill share of the always-on cost, largest first. */
  descriptions: BudgetLine[];
  skills: number;
}

/**
 * The text a host shows the model for one skill: its name and its description.
 *
 * Formatting differs between hosts — a bullet, a YAML block, an XML tag — by a
 * few tokens per skill. The content does not, and the content is what scales
 * with the number of skills you keep.
 */
function listingOf(skill: SkillDoc): string {
  const name = skill.name ?? basename(skill.dir);
  const description = skill.description ?? "";
  return `${name}: ${description}`;
}

export function computeBudget(
  skills: readonly SkillDoc[],
  contexts: readonly ContextDoc[],
): BudgetReport {
  const descriptions: BudgetLine[] = skills
    .map((skill) => ({
      label: skill.name ?? basename(skill.dir),
      file: skill.file,
      tokens: estimateTokens(listingOf(skill)),
    }))
    .sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label));

  const descriptionTokens = descriptions.reduce((sum, line) => sum + line.tokens, 0);

  const always: BudgetLine[] = [];
  if (skills.length > 0) {
    always.push({
      label: `${skills.length} skill description${skills.length === 1 ? "" : "s"}`,
      tokens: descriptionTokens,
      count: skills.length,
    });
  }
  for (const doc of contexts.filter((c) => c.root)) {
    always.push({ label: displayPath(doc.file), file: doc.file, tokens: estimateTokens(doc.body) });
  }

  const nested: BudgetLine[] = contexts
    .filter((c) => !c.root)
    .map((doc) => ({ label: displayPath(doc.file), file: doc.file, tokens: estimateTokens(doc.body) }));

  const onActivation: BudgetLine[] = skills
    .map((skill) => ({
      label: skill.name ?? basename(skill.dir),
      file: skill.file,
      tokens: estimateTokens(skill.body),
    }))
    .sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label));

  return {
    always,
    alwaysTotal: always.reduce((sum, line) => sum + line.tokens, 0),
    nested,
    onActivation,
    descriptions,
    skills: skills.length,
  };
}

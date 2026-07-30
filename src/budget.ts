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

/** One skill's two costs: the one it always charges, and the one it sometimes does. */
export interface SkillBudget {
  name: string;
  file: string;
  /** Its name + description — in context whether or not it fires. */
  description: number;
  /** Its body — added only when it does. */
  body: number;
}

export interface BudgetReport {
  /** Loaded before the user's first word, in every session. */
  always: BudgetLine[];
  alwaysTotal: number;
  /** Context files below a scanned root: read only while working in their directory. */
  nested: BudgetLine[];
  /**
   * Both costs per skill, dearest always-on first.
   *
   * Sorted on the description rather than the body, because that column is the
   * one this report exists for: `body-size` already budgets a body, and nothing
   * else tells you which description is taxing every request in the session.
   */
  perSkill: SkillBudget[];
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
  const perSkill: SkillBudget[] = skills
    .map((skill) => ({
      name: skill.name ?? basename(skill.dir),
      file: skill.file,
      description: estimateTokens(listingOf(skill)),
      body: estimateTokens(skill.body),
    }))
    .sort((a, b) => b.description - a.description || b.body - a.body || a.name.localeCompare(b.name));

  const descriptionTokens = perSkill.reduce((sum, entry) => sum + entry.description, 0);

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

  return {
    always,
    alwaysTotal: always.reduce((sum, line) => sum + line.tokens, 0),
    nested,
    perSkill,
    skills: skills.length,
  };
}

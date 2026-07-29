import { parseSkillText } from "./parse.js";
import { rules as allRules } from "./rules/index.js";
import type { CheckContext, Rule, SkillDoc, TextEdit } from "./types.js";

/** ESLint uses the same cap: repeat the fix loop until stable or 10 passes. */
export const MAX_PASSES = 10;

/**
 * Apply non-overlapping edits to `source`, porting ESLint's proven algorithm:
 * sort by (start, then end) and walk with a cursor, applying an edit only when
 * it starts at or after the cursor. An edit that overlaps an already-applied
 * one is skipped (a later pass re-emits and applies it). Deterministic.
 */
export function applyEdits(source: string, edits: TextEdit[]): { output: string; applied: number; skipped: number } {
  const valid = edits.filter((e) => e.start >= 0 && e.end >= e.start && e.end <= source.length);
  const sorted = [...valid].sort((a, b) => a.start - b.start || a.end - b.end);

  let output = "";
  let cursor = 0;
  let applied = 0;
  let skipped = 0;
  for (const edit of sorted) {
    if (edit.start < cursor) {
      skipped++;
      continue;
    }
    output += source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
    applied++;
  }
  output += source.slice(cursor);
  return { output, applied, skipped };
}

export interface FixOutcome {
  /** Final text after the fix loop stabilized. */
  output: string;
  /** True when `output` differs from the input. */
  changed: boolean;
  /** Number of fix passes run. */
  passes: number;
  /** True when the pass cap was hit while still changing — possible conflict. */
  hitCap: boolean;
  /** Ids of rules that contributed at least one applied edit. */
  fixedRuleIds: string[];
}

/** The subset of `rules` that expose an autofixer. */
export function fixableRules(rules: readonly Rule[] = allRules): Rule[] {
  return rules.filter((r) => typeof r.fix === "function");
}

/**
 * Run the multi-pass fix loop over one file's text (pure — no disk I/O). Each
 * pass re-parses the current text, collects edits from every fixable rule,
 * applies the non-overlapping set, and repeats until nothing changes or the
 * cap is reached. `ctx.skills` is only used by cross-skill fixers (none today),
 * so it can safely reflect the pre-fix skill set.
 */
export function fixText(
  file: string,
  raw: string,
  rules: readonly Rule[],
  ctx: CheckContext,
): FixOutcome {
  let text = raw;
  const fixedRuleIds = new Set<string>();
  let passes = 0;
  let hitCap = false;

  for (;;) {
    if (passes >= MAX_PASSES) {
      // Still changing at the cap → likely two fixers undoing each other.
      hitCap = text !== raw;
      break;
    }
    passes++;

    const doc = parseSkillText(file, text);
    const edits: { ruleId: string; edit: TextEdit }[] = [];
    for (const rule of rules) {
      if (!rule.fix) continue;
      for (const edit of rule.fix(doc, ctx)) edits.push({ ruleId: rule.id, edit });
    }
    if (edits.length === 0) break;

    const { output } = applyEdits(
      text,
      edits.map((e) => e.edit),
    );
    if (output === text) break; // nothing applied (all overlapped or no-ops)

    // Attribute the change to the rules whose edits survived this pass.
    const survivors = applySurvivors(text, edits);
    for (const id of survivors) fixedRuleIds.add(id);
    text = output;
  }

  return { output: text, changed: text !== raw, passes, hitCap, fixedRuleIds: [...fixedRuleIds] };
}

/**
 * Recompute which rules' edits were actually applied (not skipped for overlap)
 * in a pass, so `fixedRuleIds` reflects real changes rather than mere attempts.
 */
function applySurvivors(source: string, edits: { ruleId: string; edit: TextEdit }[]): Set<string> {
  const valid = edits.filter(
    (e) => e.edit.start >= 0 && e.edit.end >= e.edit.start && e.edit.end <= source.length,
  );
  valid.sort((a, b) => a.edit.start - b.edit.start || a.edit.end - b.edit.end);
  const ids = new Set<string>();
  let cursor = 0;
  for (const { ruleId, edit } of valid) {
    if (edit.start < cursor) continue;
    cursor = edit.end;
    ids.add(ruleId);
  }
  return ids;
}

export interface FileFixResult {
  file: string;
  before: string;
  after: string;
  changed: boolean;
  hitCap: boolean;
  fixedRuleIds: string[];
}

/**
 * Run the fix loop over already-parsed docs, using each doc's own text as the
 * substrate — no re-read, so what gets fixed is exactly what got checked.
 *
 * `rulesFor` is per-doc on purpose: a skill can switch a rule off for itself via
 * `x-skillcheck`, and a rule that is off must not be silently autofixed either.
 *
 * Nothing is written to disk. The caller decides whether to persist, so `--fix`
 * and `--fix-dry-run` run identical code.
 */
export function fixDocs(
  docs: readonly SkillDoc[],
  rulesFor: (doc: SkillDoc) => readonly Rule[],
  ctx: CheckContext,
): FileFixResult[] {
  return docs.map((doc) => {
    const outcome = fixText(doc.file, doc.raw, rulesFor(doc), ctx);
    return {
      file: doc.file,
      before: doc.raw,
      after: outcome.output,
      changed: outcome.changed,
      hitCap: outcome.hitCap,
      fixedRuleIds: outcome.fixedRuleIds,
    };
  });
}

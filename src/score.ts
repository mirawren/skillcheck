import type { CheckResult } from "./types.js";

/**
 * Deterministic "skill health" scoring.
 *
 * The score is intentionally simple and explainable — no model, no magic — so
 * it means the same thing in every repo and can back a shareable badge:
 *
 *   unit score = clamp(100 − 25·errors − 5·warnings, 0, 100)
 *   repo score = mean of every scanned unit's score (a clean unit scores 100)
 *
 * A single error (e.g. a skill that can never trigger) costs a grade; warnings
 * are cheaper because the skill still works. The weights are exported so the
 * README can state the exact formula.
 */
export const SCORE_WEIGHTS = { error: 25, warning: 5 } as const;

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface UnitScore {
  /** Absolute path of the scanned skill, plugin manifest or context file. */
  file: string;
  score: number;
  grade: Grade;
  errors: number;
  warnings: number;
}

export interface ScoreReport {
  /** 0–100, rounded. 100 when nothing was scanned. */
  score: number;
  grade: Grade;
  /** Per-unit breakdown, worst first — the lowest scores are the work list. */
  units: UnitScore[];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** The score a single unit earns for its error/warning counts. */
export function scoreForCounts(errors: number, warnings: number): number {
  return clamp(100 - SCORE_WEIGHTS.error * errors - SCORE_WEIGHTS.warning * warnings, 0, 100);
}

/** Standard A–F cut points: A ≥90, B ≥80, C ≥70, D ≥60, else F. */
export function gradeFor(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

/** shields.io named color for a grade (used by the badge output). */
export function badgeColor(grade: Grade): string {
  switch (grade) {
    case "A":
      return "brightgreen";
    case "B":
      return "green";
    case "C":
      return "yellowgreen";
    case "D":
      return "orange";
    default:
      return "red";
  }
}

/**
 * Score a check result. Every scanned unit contributes, including clean ones,
 * so adding passing skills raises the repo average and doesn't dilute it away.
 */
export function computeScore(result: CheckResult): ScoreReport {
  const counts = new Map<string, { errors: number; warnings: number }>();
  const seed = (file: string) => {
    if (!counts.has(file)) counts.set(file, { errors: 0, warnings: 0 });
  };
  for (const file of result.files.skills) seed(file);
  for (const file of result.files.plugins) seed(file);
  // Tolerated as absent: `contexts` arrived after 1.0, and this function is
  // exported. A caller holding an older CheckResult should get a score, not a
  // TypeError from inside a scoring routine.
  for (const file of result.files.contexts ?? []) seed(file);
  for (const f of result.findings) {
    const c = counts.get(f.file);
    if (!c) continue; // finding on an un-scanned file: ignore (shouldn't happen)
    if (f.severity === "error") c.errors++;
    else c.warnings++;
  }

  const units: UnitScore[] = [...counts.entries()].map(([file, c]) => {
    const score = scoreForCounts(c.errors, c.warnings);
    return { file, score, grade: gradeFor(score), errors: c.errors, warnings: c.warnings };
  });
  // Worst first, then by path for stable ordering.
  units.sort((a, b) => a.score - b.score || a.file.localeCompare(b.file));

  const score = units.length
    ? Math.round(units.reduce((sum, u) => sum + u.score, 0) / units.length)
    : 100;

  return { score, grade: gradeFor(score), units };
}

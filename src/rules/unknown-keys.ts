import { frontmatterField } from "../frontmatter.js";
import type { Rule, TextEdit } from "../types.js";

/**
 * Keys hosts actually read. Union of three overlapping specs, on purpose: a
 * strict allowlist is the #1 false-positive trap for skill linters — the
 * agentskills.io spec says runtimes MUST ignore keys they don't recognize, and
 * Claude Code adds ~19 extended fields on top of the open standard. Flagging
 * those broke real skills in other validators (microsoft/vscode #294520,
 * anthropics/claude-code #25380), so this rule stays deliberately permissive:
 * its real job is catching TYPOS, not policing the schema.
 */
const KNOWN_KEYS = new Set([
  // agentskills.io open standard
  "name",
  "description",
  "license",
  "allowed-tools",
  "metadata",
  "compatibility",
  // widely used across hosts
  "version",
  // Claude Code extended frontmatter
  "when_to_use",
  "argument-hint",
  "arguments",
  "disable-model-invocation",
  "user-invocable",
  "disallowed-tools",
  "model",
  "effort",
  "context",
  "agent",
  "background",
  "hooks",
  "paths",
  "shell",
  // skillcheck's own suppression key — see runCheck's x-skillcheck handling.
  "x-skillcheck",
]);

export const unknownKeys: Rule = {
  id: "unknown-keys",
  summary: "frontmatter keys are ones some host actually reads (catches typos)",
  docs: {
    why: "The standard requires hosts to ignore keys they don't recognize, which is exactly why a typo is invisible: `descripton:` doesn't error, it just means the skill has no description. This rule is deliberately permissive — it exists to catch near-miss spellings of real keys, not to police your metadata.",
    bad: `name: pdf-report
descripton: Generates PDF reports.`,
    good: `name: pdf-report
description: Generates PDF reports.`,
  },
  fixable: true,
  check(doc) {
    if (!doc.frontmatter) return [];
    const findings = [];
    for (const key of Object.keys(doc.frontmatter)) {
      if (KNOWN_KEYS.has(key)) continue;
      const hint = nearestKnown(key);
      findings.push({
        ruleId: this.id,
        severity: "warning" as const,
        message: `frontmatter key \`${key}\` isn't read by any known host — it will be silently ignored${hint ? ` (did you mean \`${hint}\`?)` : ""}`,
        file: doc.file,
        line: 1,
        detail: hint
          ? "Likely a typo. Run `skillcheck --fix` to rename it, or remove it if intentional."
          : undefined,
      });
    }
    return findings;
  },
  /**
   * Safe fix: rename a typo'd key to its nearest known key — but only when that
   * target isn't already present (never merge/clobber a real field) and no two
   * typos would collapse onto the same key in one pass.
   */
  fix(doc): TextEdit[] {
    if (!doc.frontmatter) return [];
    const present = Object.keys(doc.frontmatter);
    const claimed = new Set(present);
    const edits: TextEdit[] = [];
    for (const key of present) {
      if (KNOWN_KEYS.has(key)) continue;
      const nearest = nearestKnown(key);
      if (!nearest || nearest === key || claimed.has(nearest)) continue;
      const loc = frontmatterField(doc.raw, key);
      if (!loc) continue;
      claimed.add(nearest);
      edits.push({ start: loc.keyStart, end: loc.keyEnd, text: nearest });
    }
    return edits;
  },
};

function nearestKnown(key: string): string | null {
  let best: string | null = null;
  let bestDist = 3; // only suggest for close typos
  for (const known of KNOWN_KEYS) {
    const d = levenshtein(key.toLowerCase(), known);
    if (d < bestDist) {
      bestDist = d;
      best = known;
    }
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

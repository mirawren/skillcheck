import { relative } from "node:path";
import type { SkillcheckConfig } from "./config.js";
import { globToMatcher } from "./config.js";
import { discover } from "./discover.js";
import { parsePluginManifest, parseSkill } from "./parse.js";
import { checkPluginManifest } from "./plugin-checks.js";
import { rules } from "./rules/index.js";
import type { CheckContext, CheckResult, Finding, SkillDoc } from "./types.js";

export type {
  CheckResult,
  Finding,
  Rule,
  RuleDocs,
  RuleOption,
  SkillDoc,
  Severity,
  Summary,
  TextEdit,
} from "./types.js";
export type { SkillcheckConfig, RuleSetting, LoadedConfig } from "./config.js";
export { loadConfig, numberOption } from "./config.js";
export { rules } from "./rules/index.js";
export { estimateTokens } from "./tokens.js";
export { computeScore, gradeFor, badgeColor, scoreForCounts, SCORE_WEIGHTS } from "./score.js";
export type { Grade, ScoreReport, UnitScore } from "./score.js";
export { parseSkill, parseSkillText } from "./parse.js";
export { stem, tokenize, termSet, dice, STOPWORDS } from "./text.js";
export {
  buildIndex,
  indexFor,
  matchPrompt,
  rank,
  rankTerms,
  distinctiveTerms,
  CLOSE_MARGIN,
  MIN_COVERAGE,
} from "./match.js";
export type { TriggerIndex, TriggerMatch, TriggerReport, IndexedSkill, Verdict } from "./match.js";
export { loadScenarios, parseScenarios, runScenarios, findScenarioFile, ScenarioError } from "./scenarios.js";
export type { Scenario, ScenarioResult, ScenarioStatus } from "./scenarios.js";
export { applyBaseline, buildBaseline, loadBaseline, parseBaseline, findBaselineFile, BaselineError, BASELINE_FILENAME } from "./baseline.js";
export type { BaselineFile, BaselineEntry, BaselineOutcome } from "./baseline.js";
export { applyEdits, fixDocs, fixText, fixableRules } from "./fix.js";
export type { FileFixResult, FixOutcome } from "./fix.js";
export { runInit } from "./init.js";
export type { InitOptions, InitResult } from "./init.js";

/** Frontmatter key skills use to suppress specific rules on themselves. */
const SUPPRESS_KEY = "x-skillcheck";

/** The parsed inputs a check runs over: skills plus plugin-manifest paths. */
export interface CollectedDocs {
  skills: SkillDoc[];
  manifests: string[];
}

/**
 * Discover and parse everything under `roots`, applying `ignore` globs. Split
 * out from {@link runCheck} so callers that need the parsed docs (e.g. the
 * autofixer, or an honest "fixable" count) don't have to re-read from disk.
 */
export function collectDocs(roots: string[], config: SkillcheckConfig = {}): CollectedDocs {
  const matchers = (config.ignore ?? []).map(globToMatcher);
  const ignored = (file: string) => {
    const rel = relative(process.cwd(), file);
    return matchers.some((m) => m(rel));
  };

  const { skillFiles, pluginManifests } = discover(roots);
  return {
    skills: skillFiles.filter((f) => !ignored(f)).map(parseSkill),
    manifests: pluginManifests.filter((f) => !ignored(f)),
  };
}

/**
 * Run every enabled rule against already-parsed skills and plugin manifests,
 * honoring `config` (rule severities, per-rule options) and per-skill
 * `x-skillcheck` suppressions. Pure over its inputs — the fixer re-runs this on
 * modified docs to see which findings a fix actually resolves.
 *
 * Deterministic and fully offline — safe for CI with zero credentials.
 */
export function evaluate(
  skills: SkillDoc[],
  manifests: string[],
  config: SkillcheckConfig = {},
): CheckResult {
  const ctx: CheckContext = { skills, options: config.options ?? {} };

  // A rule set to "off" is not run at all — filtering its findings afterwards
  // would still pay for the check, which defeats the point of turning off an
  // expensive rule.
  const active = rules.filter((rule) => config.rules?.[rule.id] !== "off");

  let findings: Finding[] = [];
  for (const doc of skills) {
    const disabled = suppressedRules(doc);
    if (disabled === "*") continue;
    for (const rule of active) {
      if (disabled?.has(rule.id)) continue;
      findings.push(...rule.check(doc, ctx));
    }
  }
  if (config.rules?.["plugin-manifest"] !== "off") {
    for (const manifestFile of manifests) {
      findings.push(...checkPluginManifest(parsePluginManifest(manifestFile)));
    }
  }

  findings = applyRuleSettings(findings, config.rules);

  findings.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0));

  return {
    findings,
    summary: {
      errors: findings.filter((f) => f.severity === "error").length,
      warnings: findings.filter((f) => f.severity === "warning").length,
      skills: skills.length,
      plugins: manifests.length,
    },
    files: {
      skills: skills.map((s) => s.file),
      plugins: manifests,
    },
  };
}

/**
 * Discover, parse, and check every SKILL.md and plugin manifest under `roots`.
 * The one-call convenience wrapper over {@link collectDocs} + {@link evaluate}.
 */
export function runCheck(roots: string[], config: SkillcheckConfig = {}): CheckResult {
  const { skills, manifests } = collectDocs(roots, config);
  return evaluate(skills, manifests, config);
}

/**
 * Rules this skill turned off for itself via `x-skillcheck: { disable: [...] }`
 * — `"*"` for all of them, or null when it opted out of nothing. Exported so
 * the autofixer honors the same opt-out the checker does.
 */
export function suppressedRules(doc: SkillDoc): Set<string> | "*" | null {
  const raw = doc.frontmatter?.[SUPPRESS_KEY];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const disable = (raw as Record<string, unknown>).disable;
  if (disable === "*" || disable === true) return "*";
  if (Array.isArray(disable)) {
    return new Set(disable.filter((v): v is string => typeof v === "string"));
  }
  return null;
}

/** Apply config rule settings: drop `off`, override severity for `warn`/`error`. */
function applyRuleSettings(
  findings: Finding[],
  ruleSettings: SkillcheckConfig["rules"],
): Finding[] {
  if (!ruleSettings) return findings;
  const out: Finding[] = [];
  for (const f of findings) {
    const setting = ruleSettings[f.ruleId];
    if (setting === "off") continue;
    if (setting === "error") out.push({ ...f, severity: "error" });
    else if (setting === "warn" || setting === "warning") out.push({ ...f, severity: "warning" });
    else out.push(f);
  }
  return out;
}

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import {
  applyBaseline,
  BASELINE_FILENAME,
  BaselineError,
  buildBaseline,
  type BaselineEntry,
  findBaselineFile,
  loadBaseline,
  serializeBaseline,
} from "./baseline.js";
import { ConfigError, globToMatcher, loadConfig, type SkillcheckConfig } from "./config.js";
import { compareCorpora, driftFailed } from "./drift.js";
import { type FileFixResult, fixableRules, fixDocs, MAX_PASSES } from "./fix.js";
import { collectDocs, evaluate, suppressedRules } from "./index.js";
import { runInit } from "./init.js";
import {
  describeLanguage,
  LANGUAGES,
  LOW_CONFIDENCE,
} from "./languages/index.js";
import { buildIndex, languageOf, matchPrompt } from "./match.js";
import { displayPath, toPosix } from "./paths.js";
import { displayWidth, padDisplay } from "./script.js";
import {
  type Format,
  render,
  renderDrift,
  renderExplain,
  renderScenarioResults,
  renderTrigger,
} from "./report.js";
import { readFileAtRef, readSkillsAtRef, RevisionError } from "./revision.js";
import { catalog, rules } from "./rules/index.js";
import { computeScore } from "./score.js";
import {
  findScenarioFile,
  loadScenarios,
  parseScenarios,
  runScenarios,
  scenarioCoverage,
  SCENARIO_FILENAMES,
  ScenarioError,
  type ScenarioSeed,
} from "./scenarios.js";
import type { CheckContext, CheckResult, Finding, Rule, SkillDoc } from "./types.js";

/** Everything the CLI touches outside the filesystem, so tests can capture it. */
export interface CliIO {
  out(text: string): void;
  err(text: string): void;
  env: NodeJS.ProcessEnv;
}

export const nodeIo: CliIO = {
  out: (text) => void process.stdout.write(text),
  err: (text) => void process.stderr.write(text),
  env: process.env,
};

/** Bad invocation — always exit code 2, never 1 (1 means "found problems"). */
class UsageError extends Error {}

const HELP = `skillcheck — activation preflight for agent skills

Usage
  skillcheck [paths...] [options]        check skills and plugin manifests (default)
  skillcheck why "<request>" [paths...]  show which skill a request would reach
  skillcheck diff [<ref>] [paths...]     what this change did to which skill wins
  skillcheck test [paths...]             run trigger scenarios from skillcheck.scenarios.yaml
  skillcheck explain <rule>              why a rule exists, with examples
  skillcheck init [dir]                  add CI, starter trigger tests and a badge
  skillcheck rules                       list every check
  skillcheck languages [paths...]        which languages your skills are written in

  Scans for SKILL.md files and .claude-plugin/plugin.json manifests.
  Offline, deterministic, no credentials, no network.

Options
  --format <pretty|json|github|sarif|badge|markdown>
                          pretty (default) · github = PR annotations ·
                          sarif = code scanning · badge = shields.io endpoint JSON
  --fix                   apply safe automatic fixes, then re-check
  --fix-dry-run           report what --fix would change, write nothing
  --config <path>         config file (default: nearest skillcheck.config.json)
  --baseline <path>       accept the findings in this file (default: ${BASELINE_FILENAME} if present)
  --update-baseline       rewrite the baseline from the current findings
  --no-baseline           ignore any baseline file
  --scenarios <path>      scenarios file for \`test\` (default: skillcheck.scenarios.yaml)
  --max-warnings <n>      fail when warnings exceed n (default: unlimited)
  --quiet                 show errors only
  --summary               append a markdown report to $GITHUB_STEP_SUMMARY
  --force                 let \`init\` overwrite existing files
  --list-rules            list every check and exit
  --version               print version and exit
  --help                  show this help

Exit codes
  0  clean (and warnings within --max-warnings)
  1  errors found, warnings over the limit, a failing scenario, or unintended drift
  2  bad usage, bad config, no inputs found, or an internal error
`;

type Command =
  | "check"
  | "why"
  | "diff"
  | "test"
  | "explain"
  | "init"
  | "rules"
  | "languages"
  | "help"
  | "version";

const COMMANDS = new Set(["check", "why", "diff", "test", "explain", "init", "rules", "languages"]);
const FORMATS = new Set(["pretty", "json", "github", "sarif", "badge", "markdown"]);

interface Args {
  command: Command;
  positional: string[];
  format: Format;
  maxWarnings: number;
  quiet: boolean;
  config?: string;
  fix: boolean;
  fixDryRun: boolean;
  baseline?: string;
  noBaseline: boolean;
  updateBaseline: boolean;
  scenarios?: string;
  summary: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: "check",
    positional: [],
    format: "pretty",
    maxWarnings: Number.POSITIVE_INFINITY,
    quiet: false,
    fix: false,
    fixDryRun: false,
    noBaseline: false,
    updateBaseline: false,
    summary: false,
    force: false,
  };

  let i = 0;
  if (argv[0] && COMMANDS.has(argv[0])) {
    args.command = argv[0] as Command;
    i = 1;
  }

  for (; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`${arg} expects a value`);
      return value;
    };

    switch (arg) {
      case "--help":
      case "-h":
        args.command = "help";
        return args;
      case "--version":
      case "-v":
        args.command = "version";
        return args;
      case "--list-rules":
        args.command = "rules";
        return args;
      case "--quiet":
        args.quiet = true;
        break;
      case "--fix":
        args.fix = true;
        break;
      case "--fix-dry-run":
        args.fixDryRun = true;
        break;
      case "--summary":
        args.summary = true;
        break;
      case "--force":
        args.force = true;
        break;
      case "--no-baseline":
        args.noBaseline = true;
        break;
      case "--update-baseline":
        args.updateBaseline = true;
        break;
      case "--baseline":
        args.baseline = next();
        break;
      case "--scenarios":
        args.scenarios = next();
        break;
      case "--config":
        args.config = next();
        break;
      case "--format": {
        const value = next();
        if (!FORMATS.has(value)) {
          throw new UsageError(`--format must be one of ${[...FORMATS].join(", ")} (got ${value})`);
        }
        args.format = value as Format;
        break;
      }
      case "--max-warnings": {
        const value = Number(next());
        if (!Number.isInteger(value) || value < 0) {
          throw new UsageError("--max-warnings expects a non-negative integer");
        }
        args.maxWarnings = value;
        break;
      }
      default:
        if (arg.startsWith("-")) throw new UsageError(`unknown option ${arg}`);
        args.positional.push(arg);
    }
  }
  return args;
}

/**
 * Run skillcheck and return its exit code. Every command lives behind this one
 * function — no `process.exit` inside, so the whole CLI is testable in-process.
 */
export function runCli(argv: string[], io: CliIO = nodeIo): number {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    return usage(io, err as Error);
  }

  try {
    switch (args.command) {
      case "help":
        io.out(HELP);
        return 0;
      case "version":
        io.out(`${readVersion()}\n`);
        return 0;
      case "rules":
        return commandRules(io);
      case "languages":
        return commandLanguages(args, io);
      case "explain":
        return commandExplain(args, io);
      case "init":
        return commandInit(args, io);
      case "why":
        return commandWhy(args, io);
      case "diff":
        return commandDiff(args, io);
      case "test":
        return commandTest(args, io);
      default:
        return commandCheck(args, io);
    }
  } catch (err) {
    if (err instanceof UsageError) return usage(io, err);
    if (
      err instanceof ConfigError ||
      err instanceof BaselineError ||
      err instanceof ScenarioError ||
      err instanceof RevisionError
    ) {
      io.err(`skillcheck: ${err.message}\n`);
      return 2;
    }
    io.err(`skillcheck: ${(err as Error).message}\n`);
    return 2;
  }
}

function usage(io: CliIO, err: Error): number {
  io.err(`skillcheck: ${err.message}\n\n${HELP}`);
  return 2;
}

function readVersion(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  return (JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string }).version;
}

function pathsOf(args: Args, from = 0): string[] {
  const paths = args.positional.slice(from);
  return paths.length ? paths : ["."];
}

function requireExisting(paths: string[]): void {
  for (const path of paths) {
    if (!existsSync(path)) throw new UsageError(`path not found: ${path}`);
  }
}

// ─────────────────────────────────────────────────────────── check ──────────

function commandCheck(args: Args, io: CliIO): number {
  const paths = pathsOf(args);
  requireExisting(paths);

  const config = loadConfig(args.config).config;
  let docs = collectDocs(paths, config);
  if (docs.skills.length === 0 && docs.manifests.length === 0) {
    io.err(
      `skillcheck: no SKILL.md or .claude-plugin/plugin.json found under ${paths.join(", ")}\n`,
    );
    io.err(pc.dim("  check the paths and ignore patterns in your config.\n"));
    return 2;
  }
  let ctx: CheckContext = { skills: docs.skills, options: config.options ?? {} };

  // ── autofix ──────────────────────────────────────────────────────────────
  const rulesFor = fixableRulesFor(config.rules);
  let fixed: FileFixResult[] = [];
  if (args.fix || args.fixDryRun) {
    fixed = fixDocs(docs.skills, rulesFor, ctx).filter((r) => r.changed);
    if (args.fix && fixed.length > 0) {
      for (const result of fixed) writeFileSync(result.file, result.after);
      // Re-read so the report — and anything else reading ctx — reflects what
      // is now on disk rather than what was there before the fix.
      docs = collectDocs(paths, config);
      ctx = { skills: docs.skills, options: config.options ?? {} };
    }
  }

  const result = evaluate(docs.skills, docs.manifests, config);
  // The score is always computed over EVERY finding. A baseline decides what
  // fails CI; it must never flatter the badge.
  const score = computeScore(result);

  // ── baseline ─────────────────────────────────────────────────────────────
  if (args.updateBaseline) return writeBaseline(args, result, io);

  const baselinePath = args.noBaseline ? null : findBaselineFile(args.baseline);
  let reported = result;
  let hidden = 0;
  let stale: BaselineEntry[] = [];
  if (baselinePath) {
    const outcome = applyBaseline(result.findings, loadBaseline(baselinePath));
    hidden = outcome.suppressed.length;
    stale = outcome.stale;
    reported = withFindings(result, outcome.remaining);
  }

  const shown = args.quiet
    ? { ...reported, findings: reported.findings.filter((f) => f.severity === "error") }
    : reported;

  io.out(`${render(shown, args.format, { version: readVersion(), score, baselined: hidden })}\n`);

  // Notes belong on stdout for human/CI-log formats and on stderr for machine
  // formats, so `--format json > out.json` stays parseable.
  const note = (text: string) =>
    args.format === "pretty" || args.format === "github" ? io.out(text) : io.err(text);

  reportFixes(args, fixed, note);
  if (!args.fix && !args.fixDryRun) {
    const repairable = countRepairable(docs.skills, shown.findings, rulesFor, ctx);
    if (repairable > 0) {
      note(pc.dim(`  ${repairable} file(s) can be repaired automatically — run: skillcheck --fix\n`));
    }
  }
  if (baselinePath) {
    if (hidden > 0) note(pc.dim(`  baseline: ${displayPath(baselinePath)}\n`));
    if (stale.length > 0) {
      note(
        pc.dim(
          `  ${stale.length} baseline entr${stale.length === 1 ? "y" : "ies"} no longer occur — run --update-baseline to shrink it\n`,
        ),
      );
    }
  }

  emitGithubOutputs(io, reported, score);
  if (args.summary) emitStepSummary(io, render(shown, "markdown", { score, baselined: hidden }));

  const failed = reported.summary.errors > 0 || reported.summary.warnings > args.maxWarnings;
  return failed ? 1 : 0;
}

/**
 * Which fixable rules may touch a given doc: a rule switched off in config, or
 * disabled by the skill's own `x-skillcheck`, must not be autofixed either.
 */
function fixableRulesFor(
  ruleSettings: Record<string, string> | undefined,
): (doc: SkillDoc) => readonly Rule[] {
  const enabled = fixableRules(rules).filter((rule) => ruleSettings?.[rule.id] !== "off");
  return (doc: SkillDoc) => {
    const off = suppressedRules(doc);
    if (off === "*") return [];
    return off ? enabled.filter((rule) => !off.has(rule.id)) : enabled;
  };
}

/** Files that `--fix` would actually change — an honest hint, not a guess. */
function countRepairable(
  skills: SkillDoc[],
  findings: readonly Finding[],
  rulesFor: (doc: SkillDoc) => readonly Rule[],
  ctx: CheckContext,
): number {
  const flagged = new Set(findings.map((f) => f.file));
  const candidates = skills.filter((doc) => flagged.has(doc.file));
  if (candidates.length === 0) return 0;
  return fixDocs(candidates, rulesFor, ctx).filter((r) => r.changed).length;
}

function reportFixes(args: Args, fixed: FileFixResult[], note: (text: string) => void): void {
  if (!args.fix && !args.fixDryRun) return;
  if (fixed.length === 0) {
    note(pc.dim("  nothing to fix automatically\n"));
    return;
  }
  const ruleIds = [...new Set(fixed.flatMap((f) => f.fixedRuleIds))].sort().join(", ");
  note(
    args.fix
      ? `${pc.green("  ✔")} fixed ${fixed.length} file(s) — ${ruleIds}\n`
      : `${pc.yellow("  →")} ${fixed.length} file(s) would change — ${ruleIds}\n`,
  );
  const stuck = fixed.filter((f) => f.hitCap);
  if (stuck.length > 0) {
    note(
      pc.yellow(
        `  ⚠ ${stuck.length} file(s) still changing after ${MAX_PASSES} passes — please open an issue\n`,
      ),
    );
  }
}

function writeBaseline(args: Args, result: CheckResult, io: CliIO): number {
  const target = args.baseline ?? BASELINE_FILENAME;
  const path = isAbsolute(target) ? target : resolve(process.cwd(), target);
  writeFileSync(path, serializeBaseline(buildBaseline(result.findings)));
  io.out(
    `${pc.green("✔")} wrote ${displayPath(path)} — ${result.findings.length} existing finding(s) accepted\n`,
  );
  io.out(pc.dim("  CI now fails only on NEW findings. Delete entries as you fix them.\n"));
  return 0;
}

function withFindings(result: CheckResult, findings: Finding[]): CheckResult {
  return {
    ...result,
    findings,
    summary: {
      ...result.summary,
      errors: findings.filter((f) => f.severity === "error").length,
      warnings: findings.filter((f) => f.severity === "warning").length,
    },
  };
}

/**
 * Publish results as GitHub Action outputs so a workflow can gate on the score
 * or commit a badge without re-running or re-parsing anything.
 */
function emitGithubOutputs(io: CliIO, result: CheckResult, score: { score: number; grade: string }): void {
  const file = io.env.GITHUB_OUTPUT;
  if (!file) return;
  const lines = [
    `score=${score.score}`,
    `grade=${score.grade}`,
    `errors=${result.summary.errors}`,
    `warnings=${result.summary.warnings}`,
    `skills=${result.summary.skills}`,
    `plugins=${result.summary.plugins}`,
  ];
  try {
    appendFileSync(file, `${lines.join("\n")}\n`);
  } catch {
    // A missing/unwritable $GITHUB_OUTPUT must never fail the check itself.
  }
}

function emitStepSummary(io: CliIO, markdown: string): void {
  const file = io.env.GITHUB_STEP_SUMMARY;
  if (!file) {
    io.err("skillcheck: --summary had no effect ($GITHUB_STEP_SUMMARY is not set)\n");
    return;
  }
  try {
    appendFileSync(file, `${markdown}\n`);
  } catch (err) {
    io.err(`skillcheck: could not write the step summary: ${(err as Error).message}\n`);
  }
}

// ───────────────────────────────────────────────────────────── why ──────────

function commandWhy(args: Args, io: CliIO): number {
  const prompt = args.positional[0];
  if (!prompt) {
    throw new UsageError('why needs a request, e.g. skillcheck why "extract text from a pdf"');
  }
  const paths = pathsOf(args, 1);
  requireExisting(paths);

  const config = loadConfig(args.config).config;
  const { skills } = collectDocs(paths, config);
  if (skills.length === 0) {
    io.err(`skillcheck: no SKILL.md found under ${paths.join(", ")}\n`);
    return 2;
  }

  const index = buildIndex(skills);
  const report = matchPrompt(index, prompt);
  io.out(`${renderTrigger(report, args.format === "json" ? "json" : "pretty", index)}\n`);
  return 0;
}

// ──────────────────────────────────────────────────────────── diff ──────────

/**
 * The revision `diff` compares against when the user names none.
 *
 * `HEAD` answers "what have I changed since my last commit", which is the
 * question at the keyboard. In CI the answer wanted is "what does this pull
 * request change", so the base ref is passed explicitly — the Action does it.
 */
const DEFAULT_DIFF_REF = "HEAD";

/**
 * `skillcheck diff [<ref>]` — the comparison every other command can't make.
 *
 * A ref looks exactly like a path, so telling them apart is a guess. The rule
 * here is deliberately dumb and predictable: the first positional is a ref
 * unless it exists on disk, in which case it is a path and the ref defaults.
 * Guessing the other way round would silently compare against the wrong thing,
 * which for this command is worse than an error.
 */
function commandDiff(args: Args, io: CliIO): number {
  const first = args.positional[0];
  const looksLikePath = first !== undefined && existsSync(first);
  const ref = first !== undefined && !looksLikePath ? first : DEFAULT_DIFF_REF;
  const paths = pathsOf(args, looksLikePath || first === undefined ? 0 : 1);
  requireExisting(paths);

  const config = loadConfig(args.config).config;
  const after = collectDocs(paths, config).skills;
  const before = readSkillsAtRef(ref, paths).filter(inScope(config));

  // A repo with no skills at either revision has nothing to compare, which is
  // not a usage error — it is the state of every repo the moment after
  // `skillcheck init` runs, and failing there would make the first pull request
  // after adopting the tool red for no reason.
  if (before.length === 0 && after.length === 0) {
    io.out(
      pc.dim(`no SKILL.md under ${paths.join(", ")}, at ${ref} or now — nothing to compare\n`),
    );
    return 0;
  }

  // Scenario prompts are the sharpest probes there are, so they're used when the
  // repo has them — but an unparseable file must not take the whole comparison
  // down, because drift is still fully answerable from the descriptions alone.
  let scenarios: ReturnType<typeof loadScenarios> = [];
  const scenarioFile = findScenarioFile(args.scenarios);
  if (scenarioFile) {
    try {
      scenarios = loadScenarios(scenarioFile);
    } catch (err) {
      io.err(pc.yellow(`skillcheck: ignoring ${displayPath(scenarioFile)} — ${(err as Error).message}\n`));
    }
    scenarios = assertedAtBothRevisions(scenarios, scenarioFile, ref, io);
  }

  const report = compareCorpora({
    ref,
    before,
    after,
    scenarios,
    findingsBefore: evaluate(before, [], historicalConfig(config)).findings,
    findingsAfter: evaluate(after, [], historicalConfig(config)).findings,
  });
  const format =
    args.format === "json" || args.format === "markdown" || args.format === "github"
      ? args.format
      : "pretty";
  io.out(`${renderDrift(report, format)}\n`);
  if (args.summary) emitStepSummary(io, renderDrift(report, "markdown"));

  return driftFailed(report) ? 1 : 0;
}

/**
 * Keep only scenario contracts that were already asserted at `ref`.
 *
 * A prompt or assertion written in the same change has no stable meaning at the
 * base revision, and ranking it there invents one. Adding a skill *together with
 * its scenario* — the workflow `skillcheck init` scaffolds — therefore failed
 * the build: the new
 * prompt was ranked against the old corpus, some incumbent "won" a request that
 * did not exist yet, and the report called it a request changing hands.
 *
 * This is the same rule already applied to description probes, which come only
 * from skills present at both revisions, and for the same reason: a comparison
 * needs a question both sides were asked. What the new prompt asserts is still
 * checked — by `skillcheck test`, against the corpus it was written for.
 */
function assertedAtBothRevisions(
  scenarios: readonly ReturnType<typeof loadScenarios>[number][],
  scenarioFile: string,
  ref: string,
  io: CliIO,
): ReturnType<typeof loadScenarios> {
  if (scenarios.length === 0) return [...scenarios];

  let before: string | null = null;
  try {
    before = readFileAtRef(ref, scenarioFile);
  } catch {
    // The file's history is unreadable — fall back to comparing nothing from it
    // rather than to inventing "before" answers.
    return [];
  }
  if (before === null) return [];

  let baseline: ReturnType<typeof loadScenarios>;
  try {
    baseline = parseScenarios(before, `${displayPath(scenarioFile)}@${ref}`);
  } catch {
    return [];
  }

  const baselinePrompts = new Set(baseline.map((s) => s.prompt.trim()));
  const baselineContracts = new Set(baseline.map(scenarioContractKey));
  const kept = scenarios.filter((s) => baselineContracts.has(scenarioContractKey(s)));
  const added = scenarios.filter((s) => !baselinePrompts.has(s.prompt.trim())).length;
  const changed = scenarios.length - kept.length - added;
  if (added > 0) {
    io.out(
      pc.dim(
        `  ${plural(added, "scenario")} added in this change ${added === 1 ? "is" : "are"} not compared — ` +
          `${added === 1 ? "it has" : "they have"} no answer at ${ref}. \`skillcheck test\` checks ${added === 1 ? "it" : "them"}.\n`,
      ),
    );
  }
  if (changed > 0) {
    io.out(
      pc.dim(
        `  ${plural(changed, "scenario assertion")} changed in this change ${changed === 1 ? "is" : "are"} not compared — ` +
          `${changed === 1 ? "it has" : "they have"} no stable contract at ${ref}. \`skillcheck test\` checks ${changed === 1 ? "it" : "them"}.\n`,
      ),
    );
  }
  return kept;
}

/** A scenario contract's semantic identity; list order does not change what it permits. */
function scenarioContractKey(scenario: ReturnType<typeof loadScenarios>[number]): string {
  return JSON.stringify({
    prompt: scenario.prompt.trim(),
    expect: scenario.expectNone ? ["none"] : [...scenario.expect].sort(),
    forbid: [...scenario.forbid].sort(),
  });
}

/** `1 scenario` / `2 scenarios`. */
function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * The config to evaluate both revisions under, for the "what did this change
 * introduce" half of the report.
 *
 * `broken-references` is switched off for the comparison, and only there. It
 * asks the filesystem whether a linked file exists, and the filesystem only
 * holds the *current* revision — so the historical side would be answered with
 * today's files and report every such finding as either new or fixed at random.
 * Running the check normally still reports it; what's suppressed is a claim
 * about it having *changed*, which this comparison genuinely cannot make.
 */
function historicalConfig(config: SkillcheckConfig): SkillcheckConfig {
  return { ...config, rules: { ...config.rules, "broken-references": "off" } };
}

/**
 * The same `ignore` globs {@link collectDocs} applies, so a skill excluded from
 * the check isn't dragged back in by the historical side of the comparison.
 */
function inScope(config: ReturnType<typeof loadConfig>["config"]): (doc: SkillDoc) => boolean {
  const matchers = (config.ignore ?? []).map(globToMatcher);
  if (matchers.length === 0) return () => true;
  return (doc) => {
    const rel = toPosix(doc.file);
    return !matchers.some((m) => m(rel));
  };
}

// ──────────────────────────────────────────────────────────── test ──────────

function commandTest(args: Args, io: CliIO): number {
  const paths = pathsOf(args);
  requireExisting(paths);

  const file = findScenarioFile(args.scenarios);
  if (!file) {
    io.err(`skillcheck: no scenarios file (looked for ${SCENARIO_FILENAMES.join(" or ")})\n`);
    io.err(pc.dim("  `skillcheck init` writes a starter one.\n"));
    return 2;
  }

  const scenarios = loadScenarios(file);
  if (scenarios.length === 0) {
    io.err(`skillcheck: ${displayPath(file)} has no scenarios\n`);
    return 2;
  }

  const config = loadConfig(args.config).config;
  const { skills } = collectDocs(paths, config);
  if (skills.length === 0) {
    io.err(`skillcheck: no SKILL.md found under ${paths.join(", ")}\n`);
    return 2;
  }

  const index = buildIndex(skills);
  const results = runScenarios(index, scenarios);
  const coverage = scenarioCoverage(index, scenarios);
  const format =
    args.format === "json" || args.format === "markdown" || args.format === "github"
      ? args.format
      : "pretty";
  if (format === "pretty") {
    io.out(
      `${pc.dim(`${displayPath(file)} — ${scenarios.length} scenario(s) against ${skills.length} skill(s)`)}\n\n`,
    );
  }
  io.out(`${renderScenarioResults(results, format, { coverage, source: file })}\n`);
  if (args.summary) {
    emitStepSummary(io, renderScenarioResults(results, "markdown", { coverage, source: file }));
  }
  return results.some((r) => r.status === "fail") ? 1 : 0;
}

// ───────────────────────────────────────────────────── explain / rules ──────

function commandExplain(args: Args, io: CliIO): number {
  const id = args.positional[0];
  if (!id) throw new UsageError("explain needs a rule id — run `skillcheck rules` to see them");

  const rule = catalog.find((r) => r.id === id);
  if (!rule) {
    io.err(`skillcheck: no rule named \`${id}\`\n`);
    const close = catalog.filter((r) => r.id.includes(id) || id.includes(r.id));
    if (close.length > 0) io.err(`  did you mean: ${close.map((r) => r.id).join(", ")}\n`);
    else io.err(pc.dim("  run `skillcheck rules` to list them\n"));
    return 2;
  }
  io.out(`${renderExplain(rule)}\n`);
  return 0;
}

/**
 * `skillcheck languages` — the language split of a repo, plus the registry.
 *
 * This is the command `cross-language-trigger` sends people to, and it answers
 * the question that warning raises: *which* languages are in play here, and did
 * skillcheck read each skill as the language its author meant? Detection runs on
 * the description, so a short or loanword-heavy one can be read as English; the
 * fix is to declare it, and the only way anyone discovers they need to is by
 * seeing the guess spelled out next to the file it was made about.
 */
function commandLanguages(args: Args, io: CliIO): number {
  const paths = pathsOf(args);
  requireExisting(paths);
  const config = loadConfig(args.config).config;
  const { skills } = collectDocs(paths, config);

  const groups = new Map<string, { label: string; files: string[]; unsure: string[] }>();
  for (const doc of skills) {
    const detection = languageOf(doc);
    const code = detection.pack?.code ?? "?";
    const group = groups.get(code) ?? { label: describeLanguage(detection), files: [], unsure: [] };
    const file = displayPath(doc.file);
    group.files.push(file);
    // Confidence 1 means the author declared it outright, so it is never a guess.
    if (detection.confidence < LOW_CONFIDENCE) group.unsure.push(file);
    groups.set(code, group);
  }

  const split = [...groups]
    .map(([code, group]) => ({ code, ...group }))
    .sort((a, b) => b.files.length - a.files.length || a.code.localeCompare(b.code));

  if (args.format === "json") {
    io.out(
      `${JSON.stringify(
        {
          skills: skills.length,
          languages: split.map(({ code, label, files, unsure }) => ({
            code,
            label,
            skills: files.length,
            files,
            lowConfidence: unsure,
          })),
          recognized: LANGUAGES.map(({ code, name, endonym, scripts }) => ({
            code,
            name,
            endonym,
            scripts,
          })),
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  if (skills.length === 0) {
    io.out(pc.dim(`no SKILL.md found under ${paths.join(", ")}\n\n`));
  } else {
    const width = Math.max(...split.map((entry) => displayWidth(entry.label)));
    io.out(pc.bold("Your skills\n\n"));
    for (const { label, files, unsure } of split) {
      const count = `${files.length} skill${files.length === 1 ? "" : "s"}`;
      io.out(`  ${padDisplay(label, width)}  ${count.padEnd(9)}${pc.dim(files.join(", "))}\n`);
      if (unsure.length) {
        io.out(
          pc.yellow(
            `  ${" ".repeat(width)}  ${" ".repeat(9)}↑ detected on thin evidence — declare it with ` +
              `x-skillcheck.lang in ${unsure.join(", ")}\n`,
          ),
        );
      }
    }
    io.out("\n");
    if (split.length > 1) {
      io.out(
        pc.dim(
          "A request reaches a skill through shared words, and two languages share almost\n" +
            "none — so these groups rank separately. See the cross-language-trigger rule.\n\n",
        ),
      );
    }
  }

  io.out(pc.bold(`Recognized languages (${LANGUAGES.length})\n\n`));
  for (const pack of LANGUAGES) {
    const label = pack.name === pack.endonym ? pack.name : `${pack.name} (${pack.endonym})`;
    io.out(`  ${pack.code.padEnd(3)} ${label}\n`);
  }
  io.out(
    pc.dim(
      "\nA language with no pack is never reported on rather than guessed about.\n" +
        "Adding one is a self-contained pull request — see CONTRIBUTING.md.\n",
    ),
  );
  return 0;
}

function commandRules(io: CliIO): number {
  const width = Math.max(...catalog.map((r) => r.id.length));
  for (const rule of catalog) {
    const flag = rule.fixable ? pc.green(" fix") : "    ";
    io.out(`${rule.id.padEnd(width)}${flag}  ${rule.summary}\n`);
  }
  io.out(pc.dim(`\n${catalog.length} checks · "fix" = repairable with --fix\n`));
  io.out(pc.dim("skillcheck explain <rule> for the reasoning and examples\n"));
  return 0;
}

// ──────────────────────────────────────────────────────────── init ──────────

function commandInit(args: Args, io: CliIO): number {
  const dir = args.positional[0] ?? ".";
  requireExisting([dir]);

  // Seed the starter scenarios from skills that actually exist here, so the
  // first `skillcheck test` after `init` passes. Every skill is offered, not
  // just the handful the template shows: a re-run in a repo that has grown
  // needs the full list to work out which ones aren't covered yet.
  let skills: ScenarioSeed[] = [];
  try {
    skills = collectDocs([dir], {}).skills.flatMap((skill) =>
      skill.name && skill.description
        ? [{ name: skill.name, prompt: firstSentence(skill.description) }]
        : [],
    );
  } catch {
    // Discovery is a nicety here; a scaffold must still work in an empty repo.
  }

  const result = runInit({ dir, force: args.force, version: readVersion(), skills });
  for (const file of result.created) io.out(`${pc.green("✔")} created ${file}\n`);
  for (const file of result.updated) io.out(`${pc.green("✔")} updated ${file}\n`);
  for (const file of result.skipped) io.out(`${pc.dim("·")} skipped ${file}\n`);
  if (result.notes.length > 0) {
    io.out("\n");
    for (const note of result.notes) io.out(`${note}\n`);
  }
  return 0;
}

/** First sentence of a description, capped — a readable seed prompt. */
function firstSentence(description: string): string {
  const sentence = (description.split(/(?<=[.!?])\s/)[0] ?? description).trim().replace(/\.$/, "");
  if (sentence.length <= 80) return sentence;
  // Cut at a word boundary — a seed prompt ending mid-word reads like a bug.
  const cut = sentence.slice(0, 80);
  return cut.slice(0, cut.lastIndexOf(" ")).trimEnd();
}

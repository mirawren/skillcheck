import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import YAML from "yaml";
import { CLOSE_MARGIN, matchPrompt, type TriggerIndex, type TriggerReport } from "./match.js";
import { displayPath } from "./paths.js";

/**
 * Trigger tests: a checked-in list of requests and the skill each one should
 * reach. Running them turns "does my skill still fire?" — normally answered by
 * poking at a chat window — into a deterministic check that fails a pull
 * request.
 *
 * The scoring underneath is lexical (see match.ts), so a scenario is a
 * regression test over the text that decides selection, not a prediction of the
 * model. That is precisely what makes it useful in CI: it only changes when you
 * change your descriptions.
 *
 * ## On changing this file
 *
 * A scenarios file lives in *someone else's* repository. Unlike a rule, whose
 * behaviour we can tune whenever the evidence says to, this format is a
 * contract: every field added here has to keep parsing for as long as the
 * project exists, and every field removed breaks a stranger's build. Hence
 * {@link FORMAT_VERSION}, and hence the deliberate strictness below — an
 * unknown key is an error, because the alternative is a typo'd assertion that
 * silently never runs.
 */

/**
 * The scenario-file format version.
 *
 * Absent means 1. A file declaring a *higher* version is rejected with an
 * upgrade hint rather than parsed on a best-effort basis: a newer file almost
 * certainly contains assertions this binary would ignore, and an assertion that
 * silently doesn't run is worse than no assertion at all.
 */
export const FORMAT_VERSION = 1;

/** Names auto-discovered in the working directory. */
export const SCENARIO_FILENAMES = ["skillcheck.scenarios.yaml", "skillcheck.scenarios.yml"];

/** Keys a scenario entry may carry. Anything else is a typo worth failing on. */
const SCENARIO_KEYS = ["prompt", "expect", "forbid"] as const;

/** The reserved `expect` value meaning "no skill at all should claim this". */
const NONE = "none";

export interface Scenario {
  /** A request a user would actually type. */
  prompt: string;
  /**
   * Skills that may win. More than one means any of them is acceptable — the
   * honest assertion when two skills are genuinely interchangeable for a
   * request and you only care that a third one doesn't take it.
   *
   * Empty when the scenario only forbids, or when it expects nothing to fire
   * (see {@link expectNone}).
   */
  expect: string[];
  /**
   * Skills that must not take this request.
   *
   * The assertion you want once a repo has more skills than you can hold in
   * your head: not "this exact skill wins" — which over-specifies and breaks on
   * every unrelated edit — but "whatever wins, it isn't *that* one".
   */
  forbid: string[];
  /** `expect: none` — the request should reach no skill at all. */
  expectNone: boolean;
}

export type ScenarioStatus = "pass" | "close" | "fail";

export interface ScenarioResult {
  scenario: Scenario;
  status: ScenarioStatus;
  /** Winning skill name, or null when nothing matched. */
  actual: string | null;
  report: TriggerReport;
  /** One line explaining a non-pass. */
  reason?: string;
}

/** Which scanned skills are named by at least one direct activation assertion. */
export interface ScenarioCoverage {
  /** Number of distinct skills in the trigger index. */
  total: number;
  /** Existing skill names mentioned by `expect` or `forbid`. */
  asserted: string[];
  /** Existing skill names never mentioned by either assertion. */
  unasserted: string[];
}

/** Thrown for a malformed scenarios file; the CLI maps this to exit code 2. */
export class ScenarioError extends Error {}

/** Locate the scenarios file: explicit path, else the first known name in `cwd`. */
export function findScenarioFile(explicit: string | undefined, cwd = process.cwd()): string | null {
  if (explicit) {
    const path = isAbsolute(explicit) ? explicit : resolve(cwd, explicit);
    if (!existsSync(path)) throw new ScenarioError(`scenarios file not found: ${explicit}`);
    return path;
  }
  for (const name of SCENARIO_FILENAMES) {
    const candidate = resolve(cwd, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Human-readable rendering of what a scenario asserts, for output and errors. */
export function describeExpectation(scenario: Scenario): string {
  const parts: string[] = [];
  if (scenario.expectNone) parts.push("no skill");
  else if (scenario.expect.length) parts.push(joinOr(scenario.expect));
  if (scenario.forbid.length) parts.push(`not ${joinOr(scenario.forbid)}`);
  return parts.join(", ");
}

function joinOr(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/**
 * Accept a field written either as one string or as a list of them.
 *
 * `expect: pdf-report` and `expect: [pdf-report, pdf-export]` are both natural
 * to write, and rejecting either would be pedantry that costs a first-time user
 * a round trip through the docs.
 */
function stringList(value: unknown, field: string, at: string): string[] {
  if (value === undefined || value === null) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw.map((entry) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new ScenarioError(`${at}: \`${field}\` must be a skill name, or a list of them`);
    }
    return entry.trim();
  });
}

/**
 * Parse a scenarios file. Accepts either a top-level `scenarios:` list or a
 * bare list, because both read naturally and guessing wrong shouldn't be a
 * five-minute detour for a first-time user.
 */
export function parseScenarios(text: string, path: string): Scenario[] {
  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (err) {
    throw new ScenarioError(`${path} is not valid YAML: ${(err as Error).message}`);
  }

  const doc = raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;

  if (doc) checkFormatVersion(doc.version, path);

  const list = Array.isArray(raw)
    ? raw
    : doc && Array.isArray(doc.scenarios)
      ? (doc.scenarios as unknown[])
      : null;

  if (!list) {
    throw new ScenarioError(`${path} must contain a \`scenarios:\` list (or be a list itself)`);
  }

  return list.map((entry, i) => parseScenario(entry, `${path}: scenario ${i + 1}`));
}

function checkFormatVersion(value: unknown, path: string): void {
  if (value === undefined || value === null) return;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ScenarioError(`${path}: \`version\` must be a positive integer (this skillcheck writes ${FORMAT_VERSION})`);
  }
  if (value > FORMAT_VERSION) {
    throw new ScenarioError(
      `${path} declares scenario format version ${value}, but this skillcheck only understands ${FORMAT_VERSION}. ` +
        "Upgrade with `npm install --save-dev skillcheck@latest`.",
    );
  }
}

function parseScenario(entry: unknown, at: string): Scenario {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    throw new ScenarioError(`${at} must be a mapping with \`prompt\` and \`expect\` (or \`forbid\`)`);
  }
  const fields = entry as Record<string, unknown>;

  // Strict keys. `expct:` should cost you a build, not an assertion that quietly
  // never runs — the same reasoning as the `unknown-keys` rule for SKILL.md.
  const unknown = Object.keys(fields).filter((k) => !SCENARIO_KEYS.includes(k as never));
  if (unknown.length > 0) {
    throw new ScenarioError(
      `${at} has unknown key${unknown.length > 1 ? "s" : ""} ${unknown.map((k) => `\`${k}\``).join(", ")} — expected ${SCENARIO_KEYS.map((k) => `\`${k}\``).join(", ")}`,
    );
  }

  const { prompt } = fields;
  if (typeof prompt !== "string" || prompt.trim() === "") {
    throw new ScenarioError(`${at} is missing a non-empty \`prompt\``);
  }

  const expectRaw = stringList(fields.expect, "expect", at);
  const forbid = stringList(fields.forbid, "forbid", at);

  if (expectRaw.length === 0 && forbid.length === 0) {
    throw new ScenarioError(`${at} asserts nothing — give it an \`expect\` (a skill name, or "none") or a \`forbid\``);
  }

  const expectNone = expectRaw.some((name) => name.toLowerCase() === NONE);
  if (expectNone && expectRaw.length > 1) {
    throw new ScenarioError(`${at}: \`expect: none\` means nothing should fire, so it can't be listed alongside a skill name`);
  }

  const expect = expectNone ? [] : expectRaw;

  // A name on both sides is a contradiction no run could satisfy. Catch it here
  // rather than letting it fail mysteriously against every possible ranking.
  const contradiction = expect.find((name) => forbid.includes(name));
  if (contradiction) {
    throw new ScenarioError(`${at} both expects and forbids \`${contradiction}\``);
  }

  return { prompt, expect, forbid, expectNone };
}

export function loadScenarios(path: string): Scenario[] {
  // Read the real path; *name* the readable one. A parse error is something a
  // person reads in a CI log, and an absolute runner path buries the part that
  // identifies the file.
  return parseScenarios(readFileSync(path, "utf8"), displayPath(path));
}

/**
 * Run every scenario against the index.
 *
 * A scenario whose expected skill wins by less than the coin-flip margin is
 * reported as `close` rather than `pass`: it is passing today for reasons too
 * thin to depend on. Only `fail` is exit-code worthy.
 */
export function runScenarios(index: TriggerIndex, scenarios: readonly Scenario[]): ScenarioResult[] {
  const names = new Set(index.skills.map((s) => s.name));

  return scenarios.map((scenario) => {
    const report = matchPrompt(index, scenario.prompt);
    const top = report.matches[0];
    const actual = report.verdict === "none" ? null : (top?.name ?? null);
    const fail = (reason: string): ScenarioResult => ({ scenario, status: "fail", actual, report, reason });
    const close = (reason: string): ScenarioResult => ({ scenario, status: "close", actual, report, reason });

    /**
     * Every name the scenario mentions has to exist. A typo'd — or since
     * deleted — skill name makes the assertion vacuous, and an assertion that
     * silently stopped testing anything is the one failure mode a regression
     * suite must never have. This covers `forbid` too: "must not fire" is
     * trivially true of a skill that isn't there, which is exactly why it needs
     * saying out loud.
     */
    const missing = [...scenario.expect, ...scenario.forbid].filter((name) => !names.has(name));
    if (missing.length > 0) {
      return fail(
        `no skill named ${missing.map((n) => `\`${n}\``).join(", ")} was found in the scanned paths — ` +
          "fix the name, or drop the line if the skill is gone for good",
      );
    }

    if (scenario.expectNone) {
      return actual === null
        ? { scenario, status: "pass" as const, actual, report }
        : fail(`expected no skill to match, but ${actual} did`);
    }

    /**
     * `forbid` first: it is the stronger statement of the two, so when a
     * scenario both expects and forbids, the forbidden skill winning is the
     * more useful thing to print.
     *
     * "Must not win" alone would be too weak a reading. A forbidden skill
     * sitting a hair behind the winner is a coin flip, and a coin flip is
     * precisely what this tool exists to report — so it warns, on the same
     * {@link CLOSE_MARGIN} the rest of the tool judges ties by.
     */
    if (scenario.forbid.length > 0 && actual !== null && top) {
      if (scenario.forbid.includes(actual)) {
        return fail(`${actual} must not take this request, but it ranked first`);
      }
      const contender = report.matches.find(
        (m) => scenario.forbid.includes(m.name) && (top.score - m.score) / top.score < CLOSE_MARGIN,
      );
      if (contender) {
        const gap = Math.round(((top.score - contender.score) / top.score) * 100);
        return close(`${contender.name} is forbidden and trails ${actual} by only ${gap}% — too close to rely on`);
      }
    }

    if (scenario.expect.length === 0) {
      // A forbid-only scenario, and nothing forbidden took the request.
      return { scenario, status: "pass" as const, actual, report };
    }

    if (actual === null || !scenario.expect.includes(actual)) {
      const wanted = joinOr(scenario.expect);
      return fail(
        actual ? `expected ${wanted}, but ${actual} ranked first` : `expected ${wanted}, but nothing matched the request`,
      );
    }

    return report.verdict === "close"
      ? close(`${actual} wins by only ${Math.round(report.margin * 100)}% — too close to depend on`)
      : { scenario, status: "pass" as const, actual, report };
  });
}

/**
 * Report direct assertion coverage without turning it into another threshold.
 *
 * `expect: none` protects the corpus boundary but names no individual skill.
 * Missing names are excluded because {@link runScenarios} already fails them;
 * counting a typo as coverage would make the metric less trustworthy.
 */
export function scenarioCoverage(
  index: TriggerIndex,
  scenarios: readonly Scenario[],
): ScenarioCoverage {
  const names = [...new Set(index.skills.map((skill) => skill.name))].sort();
  const mentioned = assertedSkillNames(scenarios);

  return {
    total: names.length,
    asserted: names.filter((name) => mentioned.has(name)),
    unasserted: names.filter((name) => !mentioned.has(name)),
  };
}

/** Distinct skill names explicitly mentioned by direct scenario assertions. */
export function assertedSkillNames(scenarios: readonly Scenario[]): Set<string> {
  return new Set(scenarios.flatMap((scenario) => [...scenario.expect, ...scenario.forbid]));
}

/** A skill to seed a starter scenario from. */
export interface ScenarioSeed {
  name: string;
  /** A request that should reach it — seeded from its own description. */
  prompt: string;
}

/**
 * The starter file `skillcheck init` writes.
 *
 * Seeded from the repo's own skills so the very first `skillcheck test` passes:
 * a scaffold that fails on the way out teaches nothing except that the tool is
 * noisy. The seeded prompts are lifted from each description, which makes them
 * tautological — hence the instruction to replace them with real phrasing.
 */
export function scenarioTemplate(seeds: readonly ScenarioSeed[]): string {
  const header = `# Trigger tests for your skills — run with \`npx skillcheck test\`.
#
# Each scenario is a request a user might type and what should happen to it.
# Scoring is deterministic and offline (BM25 over each skill's name and
# description), so these change when — and only when — you change the text that
# decides which skill gets picked.
#
#   expect: my-skill          this skill should take the request
#   expect: [a, b]            either one is fine — just not something else
#   expect: none              nothing should claim it
#   forbid: other-skill       whatever wins, it must not be this one
#
# \`forbid\` is the one that scales: as a repo grows past a handful of skills,
# "this exact skill wins" over-specifies and breaks on unrelated edits, while
# "the destructive one never takes this" keeps holding.
#
# The prompts below were seeded from your own descriptions, so they pass
# trivially. Replace them with the words a user would actually type — that is
# where these start earning their keep.
version: ${FORMAT_VERSION}

scenarios:
`;

  const body = seeds.length
    ? seeds
        .map((seed) => `  - prompt: ${JSON.stringify(seed.prompt)}\n    expect: ${seed.name}\n`)
        .join("\n")
    : `  - prompt: "a request that should reach your skill"\n    expect: your-skill-name\n`;

  return `${header}${body}\n  - prompt: "what time is it in Tokyo"\n    expect: none\n`;
}

import { basename } from "node:path";
import { buildIndex, CLOSE_MARGIN, matchPrompt, type TriggerMatch, type TriggerReport } from "./match.js";
import {
  describeExpectation,
  runScenarios,
  type Scenario,
  type ScenarioResult,
} from "./scenarios.js";
import type { Finding, Severity, SkillDoc } from "./types.js";

/**
 * Activation drift — what a change did to *which skill wins*.
 *
 * This is the question a pull request raises and nothing else in the toolchain
 * answers. A reviewer can see that a description changed; no diff view can show
 * that the change quietly moved a request from one skill to another, because
 * that outcome isn't written in either file. It is a property of the whole set,
 * and it only exists in the comparison.
 *
 * ## Why this can't cry wolf
 *
 * Description drift makes no quality judgement: it reports that an answer
 * changed because the author changed the text that decides it. Scenario probes
 * are stronger because a human wrote both the request and its allowed outcome.
 * The same assertion runs on both revisions, so a build fails only when a
 * contract that passed before fails now; repairs and allowed movement stay
 * green. That asymmetry keeps this usable without thresholds or opt-outs.
 *
 * ## The distinction that makes it usable
 *
 * Not all drift is equally interesting, and getting this wrong would make the
 * check unadoptable:
 *
 *   - **Collateral drift** — you edited one skill and a *different*, untouched
 *     one changed hands. Nobody intends this, nobody can see it in review, and
 *     it is the exact failure the project exists for. This fails the build.
 *   - **Intended drift** — the skill you just rewrote now claims different
 *     requests. That is what editing a description *is*. Worth printing, never
 *     worth failing.
 *
 * So the report is organized by whether the change landed where the author was
 * looking. Adding a skill never fails for its own words: a tool that punishes
 * you for adding a skill is a tool you uninstall, so a newcomer's description
 * contributes no probe and its arrival is reported, not judged. It can still
 * fail by breaking a stable scenario contract, which is exactly what should
 * fail.
 *
 * ## Where the requests come from
 *
 * Comparing rankings needs requests, and the *same* ones on both sides: a probe
 * that differed between revisions would confound "the corpus changed" with "the
 * question changed". Two stable sources:
 *
 *   1. **The scenarios file** — requests a human wrote in the words a user would
 *      use, plus the outcomes they allow or forbid. The sensitive probes; they
 *      see drift the corpus's own vocabulary can't.
 *   2. **Each skill's own description**, at both revisions. A description is the
 *      most precise available statement of what a skill claims, so it doubles as
 *      the request it should most obviously win. When an edited description
 *      contributes both its old and new wording, the two probes ask two
 *      genuinely different questions: do the requests this skill *used to* claim
 *      still reach it, and does something else already own the ones it claims
 *      now?
 *
 * Which means full corpus coverage with no configuration, in a repo that has
 * never written a scenario — nearly all of them.
 */

/** Where a probe request came from. Reported, because it changes how to read it. */
export type ProbeSource = "scenario" | "description";

export interface Probe {
  /** The request text, ranked identically against both revisions. */
  prompt: string;
  source: ProbeSource;
  /**
   * For a description probe, the skill whose wording produced it — the skill
   * that ought to win it, and the one whose name belongs in the output.
   */
  owner?: string;
  /** Whether that owner's own decisive text changed in this diff. */
  ownerTouched?: boolean;
  /** The stable assertion attached to a scenario probe, when it has one. */
  scenario?: Scenario;
  /** Single-line text to print for this probe. */
  label: string;
}

/**
 * What changed for one probe.
 *
 * Scenario probes are judged against their checked-in contract: `regressed`
 * newly breaks it, `repaired` restores it, and `allowed` moves between outcomes
 * the contract permits. Description probes retain the location-based
 * `collateral` / `intended` distinction.
 */
export type DriftKind =
  | "regressed"
  | "collateral"
  | "lost"
  | "narrowed"
  | "repaired"
  | "allowed"
  | "intended"
  | "gained";

export interface ProbeDrift {
  probe: Probe;
  kind: DriftKind;
  /** Winning skill before, or null when nothing matched enough of the request. */
  before: string | null;
  /** Winning skill after, or null. */
  after: string | null;
  /** The winner's lead over the runner-up, 0–1, at each revision. */
  marginBefore: number;
  marginAfter: number;
  /** One line stating what changed, in the terms a reviewer needs. */
  detail: string;
}

/**
 * A finding this change introduced, or resolved.
 *
 * The rules already know how to say "these two skills collide" or "this one is
 * shadowed". What they can't say on their own is *whether this pull request is
 * what did it* — and that question is the difference between a report a reviewer
 * acts on and sixty pre-existing findings they scroll past.
 *
 * It is also the baseline feature without the baseline file: a repo adopting
 * skillcheck mid-life gets "only what this change broke" on its very first run,
 * with nothing to commit and nothing to keep up to date.
 */
export interface FindingChange {
  status: "new" | "fixed";
  ruleId: string;
  file: string;
  message: string;
  severity: Severity;
  /** True when the skill this lands on is not one the change edited. */
  collateral: boolean;
}

/** A skill that appeared, disappeared, or had its decisive text edited. */
export interface SkillChange {
  file: string;
  name: string;
  kind: "added" | "removed" | "retriggered" | "renamed";
  /** Which decisive fields changed: `description`, `name`. */
  fields: string[];
}

/**
 * A scenario assertion that cannot be compared across revisions.
 *
 * These are review information, not failures: the current assertion still
 * belongs to `skillcheck test`, while `diff` only judges contracts that exist
 * unchanged on both sides.
 */
export type ScenarioContractChange =
  | { kind: "added"; before: null; after: Scenario }
  | { kind: "changed"; before: Scenario; after: Scenario }
  | { kind: "removed"; before: Scenario; after: null };

export interface DriftReport {
  /** The revision compared against, as the user spelled it. */
  ref: string;
  skillsBefore: number;
  skillsAfter: number;
  changes: SkillChange[];
  /** Every probe whose outcome moved, most serious first. */
  drifts: ProbeDrift[];
  /** Findings this change introduced or resolved, new ones first. */
  findings: FindingChange[];
  /** Assertions skipped because no identical contract exists on both sides. */
  scenarioChanges?: ScenarioContractChange[];
  probes: { total: number; scenarios: number; descriptions: number };
}

/**
 * How far a winner's lead has to fall before it's worth a line of output.
 *
 * A scenario that still passes but whose lead collapsed from 40% to 4% is one
 * wording tweak from flipping, and no pass/fail check can say so. Coarse on
 * purpose: this reports structural movement, not arithmetic noise.
 */
const NARROW_DROP = 0.15;

/** Longest probe label printed before truncation. */
const LABEL_WIDTH = 58;

function skillName(doc: SkillDoc): string {
  return doc.name ?? basename(doc.dir);
}

/**
 * One line of request text for a probe.
 *
 * A description probe's text is the whole description — right for ranking, far
 * too long to print — so the label is its first sentence. The *prompt* is never
 * shortened: shortening it would change the ranking, and the output would then
 * be about a request nobody asked.
 */
function labelFor(text: string): string {
  const sentence = (text.split(/(?<=[.!?])\s/)[0] ?? text).trim();
  if (sentence.length <= LABEL_WIDTH) return sentence;
  const cut = sentence.slice(0, LABEL_WIDTH);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > 20 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

/** Which skills were added, removed, or had their decisive text edited. */
export function skillChanges(
  before: readonly SkillDoc[],
  after: readonly SkillDoc[],
): SkillChange[] {
  const beforeByFile = new Map(before.map((d) => [d.file, d]));
  const afterByFile = new Map(after.map((d) => [d.file, d]));
  const changes: SkillChange[] = [];

  for (const doc of after) {
    const was = beforeByFile.get(doc.file);
    if (!was) {
      changes.push({ file: doc.file, name: skillName(doc), kind: "added", fields: [] });
      continue;
    }
    // Only the two fields a host shows the model are decisive here. A rewritten
    // body cannot move a ranking, so reporting it would be noise in a report
    // whose entire value is that every line changed an outcome.
    const fields: string[] = [];
    if ((was.description ?? "") !== (doc.description ?? "")) fields.push("description");
    if ((was.name ?? "") !== (doc.name ?? "")) fields.push("name");
    if (fields.length === 0) continue;
    changes.push({
      file: doc.file,
      name: skillName(doc),
      kind: fields.length === 1 && fields[0] === "name" ? "renamed" : "retriggered",
      fields,
    });
  }

  for (const doc of before) {
    if (afterByFile.has(doc.file)) continue;
    changes.push({ file: doc.file, name: skillName(doc), kind: "removed", fields: [] });
  }

  return changes.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Build the comparable probe set.
 *
 * Description probes come only from skills present at *both* revisions. An added
 * skill's own words trivially "change hands" to it, and a removed one's
 * trivially leave — reporting either as drift would bury the real findings under
 * the consequences of the change the author is describing in the PR title.
 * An added skill is reported in {@link SkillChange} and judged only by the rules,
 * which see it as an ordinary new file.
 */
export function buildProbes(
  before: readonly SkillDoc[],
  after: readonly SkillDoc[],
  scenarios: readonly Scenario[] = [],
): Probe[] {
  const scenarioProbes: Probe[] = [];
  const scenarioPrompts = new Set<string>();

  // A prompt may carry several independent contracts (for example one exact
  // winner plus one safety forbid). Preserve every scenario; deduplicating by
  // request would silently discard whichever assertion appeared first.
  for (const scenario of scenarios) {
    const prompt = scenario.prompt.trim();
    if (!prompt) continue;
    const hasContract = scenario.expectNone || scenario.expect.length > 0 || scenario.forbid.length > 0;
    scenarioProbes.push({
      prompt,
      source: "scenario",
      scenario: hasContract ? scenario : undefined,
      label: labelFor(prompt),
    });
    scenarioPrompts.add(prompt);
  }

  const descriptionProbes = new Map<string, Probe>();
  const beforeByFile = new Map(before.map((d) => [d.file, d]));
  for (const doc of after) {
    const was = beforeByFile.get(doc.file);
    if (!was) continue;
    const touched =
      (was.description ?? "") !== (doc.description ?? "") || (was.name ?? "") !== (doc.name ?? "");
    // Both wordings of an edited description, deduplicated when unchanged.
    for (const description of [doc.description, was.description]) {
      const prompt = description?.trim();
      if (!prompt || scenarioPrompts.has(prompt) || descriptionProbes.has(prompt)) continue;
      descriptionProbes.set(prompt, {
        prompt,
        source: "description",
        owner: skillName(doc),
        ownerTouched: touched,
        label: labelFor(prompt),
      });
    }
  }

  return [...scenarioProbes, ...descriptionProbes.values()];
}

/**
 * The winning skill, or null when nothing really matched.
 *
 * Returns the match rather than its name, because a skill's identity across two
 * revisions is its **file**, not its `name`. Comparing names made a pure rename
 * look like a request changing hands: rename `changelog-writer` to `changelog`,
 * touch nothing else, and every request it won reported
 * `changelog-writer → changelog` as collateral drift and failed the build — about
 * one skill, unchanged, under a new label. Names are still what gets printed;
 * they are just not what gets compared.
 */
function winnerOf(report: TriggerReport): TriggerMatch | null {
  return report.verdict === "none" ? null : (report.matches[0] ?? null);
}

function pct(margin: number): string {
  return `${Math.round(margin * 100)}%`;
}

/**
 * Classify one probe's movement.
 *
 * Returns null when nothing worth printing happened — including a lead that grew,
 * which is presumably what the author was going for.
 */
function classify(
  probe: Probe,
  before: TriggerReport,
  after: TriggerReport,
  touchedFiles: ReadonlySet<string>,
  scenarioBefore?: ScenarioResult,
  scenarioAfter?: ScenarioResult,
): ProbeDrift | null {
  const winnerBefore = winnerOf(before);
  const winnerAfter = winnerOf(after);
  const base = {
    probe,
    before: winnerBefore?.name ?? null,
    after: winnerAfter?.name ?? null,
    marginBefore: before.margin,
    marginAfter: after.margin,
  };

  if (probe.scenario && scenarioBefore && scenarioAfter) {
    const acceptedBefore = scenarioBefore.status !== "fail";
    const acceptedAfter = scenarioAfter.status !== "fail";
    const expectation = describeExpectation(probe.scenario);

    if (acceptedBefore && !acceptedAfter) {
      return {
        ...base,
        kind: "regressed",
        detail:
          `${base.before ?? "no skill"} → ${base.after ?? "no skill"} — ` +
          (scenarioAfter.reason ?? `no longer satisfies ${expectation}`),
      };
    }
    if (!acceptedBefore && acceptedAfter) {
      return {
        ...base,
        kind: "repaired",
        detail: `${base.before ?? "no skill"} → ${base.after ?? "no skill"} — now satisfies ${expectation}`,
      };
    }
    // Pre-existing failing assertions belong to `skillcheck test`; diff only
    // fails on a contract this change actually regressed.
    if (!acceptedBefore && !acceptedAfter) return null;

    // `skillcheck test` calls this boundary out as too close to depend on. Diff
    // must surface crossing it even when the winner also moves to another
    // allowed skill, or the numerical margin changed by less than NARROW_DROP.
    if (scenarioBefore.status === "pass" && scenarioAfter.status === "close") {
      return {
        ...base,
        kind: "narrowed",
        detail:
          `${base.before ?? "no skill"} → ${base.after ?? "no skill"} — still satisfies ${expectation}, but ` +
          (scenarioAfter.reason ?? "the result is now too close to depend on"),
      };
    }

    if (
      winnerBefore?.file !== winnerAfter?.file ||
      scenarioBefore.actual !== scenarioAfter.actual
    ) {
      return {
        ...base,
        kind: "allowed",
        detail: `${base.before ?? "no skill"} → ${base.after ?? "no skill"} — both satisfy ${expectation}`,
      };
    }
  }

  // Identity is the file, so a renamed skill is still the same skill.
  if (winnerBefore?.file !== winnerAfter?.file) {
    if (!winnerBefore) {
      return {
        ...base,
        kind: "gained",
        detail: `nothing matched this before; ${winnerAfter!.name} takes it now`,
      };
    }
    if (!winnerAfter) {
      return {
        ...base,
        kind: "lost",
        detail: `${winnerBefore.name} used to take this; now no skill matches enough of it`,
      };
    }
    /** The whole point of a description probe: did it move where the author was working? */
    const intended =
      probe.source === "description" &&
      probe.ownerTouched === true &&
      (touchedFiles.has(winnerBefore.file) || touchedFiles.has(winnerAfter.file));
    return {
      ...base,
      kind: intended ? "intended" : "collateral",
      detail: `${winnerBefore.name} → ${winnerAfter.name}`,
    };
  }

  if (!winnerAfter) return null;

  const drop = before.margin - after.margin;
  if (drop < NARROW_DROP) return null;
  return {
    ...base,
    kind: "narrowed",
    detail:
      after.margin < CLOSE_MARGIN
        ? `${winnerAfter.name} still wins, but its lead fell from ${pct(before.margin)} to ${pct(after.margin)} — a coin flip now`
        : `${winnerAfter.name} still wins, but its lead fell from ${pct(before.margin)} to ${pct(after.margin)}`,
  };
}

/** Report order: a changed answer outranks a changed confidence. */
const KIND_RANK: Record<DriftKind, number> = {
  regressed: 0,
  collateral: 1,
  lost: 2,
  narrowed: 3,
  repaired: 4,
  allowed: 5,
  intended: 6,
  gained: 7,
};

/**
 * Identity of a finding across two revisions.
 *
 * Rule plus file, and deliberately neither the line nor the message.
 *
 * A line number shifts when anything above it is edited, which would make every
 * finding in a touched file look new. The message is subtler and matters more:
 * `description-similarity` names the sibling it collided with, so adding a third
 * near-duplicate rewords a finding that was already there — and keying on the
 * message would report that as one problem fixed and another introduced, on a
 * skill where nothing actually changed. Rule-and-file is the identity a reader
 * means by "this was already broken".
 *
 * The cost is that two findings of one rule on one file collapse into one, so
 * trading one typo'd frontmatter key for a different typo'd key goes unreported.
 * That is the right trade: the alternative manufactures churn in every repo with
 * more than two similar skills, which is the repo this command exists for.
 */
function findingKey(finding: Finding): string {
  return `${finding.ruleId} ${finding.file}`;
}

/**
 * Which findings this change introduced or resolved.
 *
 * Both directions are reported. "You fixed two" is the only positive signal a
 * lint diff can honestly give, and a tool that only ever reports new problems
 * trains people to dread running it.
 */
function compareFindings(
  before: readonly Finding[],
  after: readonly Finding[],
  touchedFiles: ReadonlySet<string>,
): FindingChange[] {
  const beforeKeys = new Set(before.map(findingKey));
  const afterKeys = new Set(after.map(findingKey));
  const out: FindingChange[] = [];

  for (const finding of after) {
    if (beforeKeys.has(findingKey(finding))) continue;
    out.push({
      status: "new",
      ruleId: finding.ruleId,
      file: finding.file,
      message: finding.message,
      severity: finding.severity,
      collateral: !touchedFiles.has(finding.file),
    });
  }
  // One line per rule-and-file that has gone away, not per finding, so the
  // collapse described above applies symmetrically.
  const reportedFixed = new Set<string>();
  for (const finding of before) {
    const key = findingKey(finding);
    if (afterKeys.has(key) || reportedFixed.has(key)) continue;
    reportedFixed.add(key);
    out.push({
      status: "fixed",
      ruleId: finding.ruleId,
      file: finding.file,
      message: finding.message,
      severity: finding.severity,
      collateral: false,
    });
  }

  return out.sort(
    (a, b) =>
      Number(a.status === "fixed") - Number(b.status === "fixed") ||
      Number(b.collateral) - Number(a.collateral) ||
      Number(a.severity === "warning") - Number(b.severity === "warning") ||
      a.file.localeCompare(b.file) ||
      a.ruleId.localeCompare(b.ruleId),
  );
}

export interface CompareInput {
  /** The revision `before` was read from, as the user spelled it. */
  ref: string;
  before: readonly SkillDoc[];
  after: readonly SkillDoc[];
  /** Scenario prompts to use as probes, when the repo keeps a scenarios file. */
  scenarios?: readonly Scenario[];
  /** Scenario contracts omitted because they were added, edited, or removed. */
  scenarioChanges?: readonly ScenarioContractChange[];
  /**
   * Rule findings at each revision. Supplied by the caller rather than computed
   * here so this module stays pure and free of I/O — some rules read the
   * filesystem, which only the caller knows how to do correctly for a revision
   * that isn't checked out.
   */
  findingsBefore?: readonly Finding[];
  findingsAfter?: readonly Finding[];
}

/**
 * Compare two revisions of a skill corpus.
 *
 * Pure over its inputs and free of I/O — the caller supplies both corpora, so
 * this works for two directories as readily as for two git revisions, and is
 * testable without a repository.
 */
export function compareCorpora(input: CompareInput): DriftReport {
  const {
    ref,
    before,
    after,
    scenarios = [],
    scenarioChanges = [],
    findingsBefore = [],
    findingsAfter = [],
  } = input;
  const changes = skillChanges(before, after);
  const touchedFiles = new Set(changes.map((c) => c.file));
  const probes = buildProbes(before, after, scenarios);
  const indexBefore = buildIndex(before);
  const indexAfter = buildIndex(after);
  const scenarioProbes = probes.filter(
    (probe): probe is Probe & { scenario: Scenario } => probe.scenario !== undefined,
  );
  // Batch scenario evaluation so runScenarios builds its corpus-wide name set
  // once per revision, not once per assertion. Matching still does the useful
  // O(scenarios × skills) work; validation no longer adds another such pass.
  const scenariosBefore = runScenarios(
    indexBefore,
    scenarioProbes.map((probe) => probe.scenario),
  );
  const scenariosAfter = runScenarios(
    indexAfter,
    scenarioProbes.map((probe) => probe.scenario),
  );

  const drifts: ProbeDrift[] = [];
  let scenarioIndex = 0;
  for (const probe of probes) {
    const scenarioBefore = probe.scenario ? scenariosBefore[scenarioIndex] : undefined;
    const scenarioAfter = probe.scenario ? scenariosAfter[scenarioIndex++] : undefined;
    const drift = classify(
      probe,
      scenarioBefore?.report ?? matchPrompt(indexBefore, probe.prompt),
      scenarioAfter?.report ?? matchPrompt(indexAfter, probe.prompt),
      touchedFiles,
      scenarioBefore,
      scenarioAfter,
    );
    if (drift) drifts.push(drift);
  }

  drifts.sort(
    (a, b) =>
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      // Scenario probes first within a kind: a human wrote those words down.
      Number(a.probe.source === "description") - Number(b.probe.source === "description") ||
      a.probe.label.localeCompare(b.probe.label),
  );

  return {
    ref,
    skillsBefore: before.length,
    skillsAfter: after.length,
    changes,
    drifts,
    findings: compareFindings(findingsBefore, findingsAfter, touchedFiles),
    scenarioChanges: [...scenarioChanges],
    probes: {
      total: probes.length,
      scenarios: probes.filter((p) => p.source === "scenario").length,
      descriptions: probes.filter((p) => p.source === "description").length,
    },
  };
}

/**
 * Whether a drift report should fail a build.
 *
 * Four things do: a checked-in scenario contract that regressed, a description
 * probe that changed hands somewhere the author wasn't looking, a request that
 * stopped reaching anything at all, and a *new error* this change introduced.
 *
 * Nothing else. Repairs, allowed movement, intended drift, a narrowing lead,
 * and a new warning are reported without failing.
 */
export function driftFailed(report: DriftReport): boolean {
  return (
    report.drifts.some(
      (d) => d.kind === "regressed" || d.kind === "collateral" || d.kind === "lost",
    ) ||
    report.findings.some((f) => f.status === "new" && f.severity === "error")
  );
}

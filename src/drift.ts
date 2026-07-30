import { basename } from "node:path";
import { buildIndex, CLOSE_MARGIN, matchPrompt, type TriggerMatch, type TriggerReport } from "./match.js";
import type { Scenario } from "./scenarios.js";
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
 * Every judgemental check has to decide whether some arrangement of text is
 * *bad*, and can be wrong about it — the failure mode that gets a linter
 * deleted. Drift makes no such judgement. It reports that an answer changed, and
 * it changed because the author changed the text that decides it. A reported
 * flip is a fact about two revisions; if it was intended, the reviewer nods and
 * moves on. That asymmetry is why this runs with no configuration and no
 * thresholds to tune.
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
 * looking. Adding a skill never fails a build *for existing*: a tool that punishes
 * you for adding a skill is a tool you uninstall, so a newcomer's own description
 * contributes no probe and its arrival is reported, not judged. It can still fail
 * one way — by taking a request the scenarios file pins to another skill — and
 * that is a human-written assertion being broken, which is exactly what should
 * fail.
 *
 * ## Where the requests come from
 *
 * Comparing rankings needs requests, and the *same* ones on both sides: a probe
 * that differed between revisions would confound "the corpus changed" with "the
 * question changed". Two stable sources:
 *
 *   1. **The scenarios file** — requests a human wrote in the words a user would
 *      use. The sensitive probes; they see drift the corpus's own vocabulary
 *      can't.
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
  /** Single-line text to print for this probe. */
  label: string;
}

/**
 * What changed for one probe.
 *
 * `collateral` is the headline: a request changed hands between two skills that
 * this change didn't touch. `intended` is the same movement, on a skill the
 * author was editing. `narrowed` is a winner that held on but stopped being
 * safe.
 */
export type DriftKind = "collateral" | "intended" | "lost" | "gained" | "narrowed";

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
  const byPrompt = new Map<string, Probe>();

  for (const scenario of scenarios) {
    const prompt = scenario.prompt.trim();
    if (prompt) byPrompt.set(prompt, { prompt, source: "scenario", label: labelFor(prompt) });
  }

  const beforeByFile = new Map(before.map((d) => [d.file, d]));
  for (const doc of after) {
    const was = beforeByFile.get(doc.file);
    if (!was) continue;
    const touched =
      (was.description ?? "") !== (doc.description ?? "") || (was.name ?? "") !== (doc.name ?? "");
    // Both wordings of an edited description, deduplicated when unchanged.
    for (const description of [doc.description, was.description]) {
      const prompt = description?.trim();
      if (!prompt || byPrompt.has(prompt)) continue;
      byPrompt.set(prompt, {
        prompt,
        source: "description",
        owner: skillName(doc),
        ownerTouched: touched,
        label: labelFor(prompt),
      });
    }
  }

  return [...byPrompt.values()];
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
    /**
     * The whole point of the report: was the skill that changed hands one the
     * author was working on?
     *
     * A scenario probe is always treated as collateral. Its wording is fixed and
     * human-written, so nothing the author did to a description makes a
     * different answer to it *intended* — that assertion is the closest thing
     * the repo has to a specification. That is also why adding a skill can fail
     * a build after all: not for existing, but for taking a request the
     * scenarios file pins to something else.
     */
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
  collateral: 0,
  lost: 1,
  narrowed: 2,
  intended: 3,
  gained: 4,
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
  const { ref, before, after, scenarios = [], findingsBefore = [], findingsAfter = [] } = input;
  const changes = skillChanges(before, after);
  const touchedFiles = new Set(changes.map((c) => c.file));
  const probes = buildProbes(before, after, scenarios);
  const indexBefore = buildIndex(before);
  const indexAfter = buildIndex(after);

  const drifts: ProbeDrift[] = [];
  for (const probe of probes) {
    const drift = classify(
      probe,
      matchPrompt(indexBefore, probe.prompt),
      matchPrompt(indexAfter, probe.prompt),
      touchedFiles,
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
 * Three things do: a request that changed hands somewhere the author wasn't
 * looking, a request that stopped reaching anything at all, and a *new error*
 * this change introduced.
 *
 * Nothing else. Intended drift, a narrowing lead, and a new warning are all
 * reported and none of them fail — a check that fails on the expected
 * consequences of an ordinary edit gets switched off within a week, and takes
 * the useful signal with it.
 */
export function driftFailed(report: DriftReport): boolean {
  return (
    report.drifts.some((d) => d.kind === "collateral" || d.kind === "lost") ||
    report.findings.some((f) => f.status === "new" && f.severity === "error")
  );
}

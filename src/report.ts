import pc from "picocolors";
import type { DriftKind, DriftReport, ProbeDrift } from "./drift.js";
import { describeLanguage } from "./languages/index.js";
import { contenderTerms, type TriggerIndex, type TriggerReport } from "./match.js";
import { REPO_URL, ruleDocUrl } from "./meta.js";
import { displayPath, toPosix } from "./paths.js";
import { catalog } from "./rules/index.js";
import { displayWidth, padDisplay } from "./script.js";
import type { ScenarioResult } from "./scenarios.js";
import { badgeColor, computeScore, type ScoreReport } from "./score.js";
import type { CheckResult, Finding, RuleDocs, RuleInfo } from "./types.js";

export type Format = "pretty" | "json" | "github" | "sarif" | "badge" | "markdown";

export interface RenderMeta {
  /** skillcheck version, surfaced in SARIF tool metadata. */
  version?: string;
  /**
   * Score to display. The CLI passes the score of *every* finding even when a
   * baseline is hiding some of them: a baseline decides what fails CI, never
   * what the badge claims.
   */
  score?: ScoreReport;
  /**
   * How many findings a baseline absorbed. Reported so "no problems" can't be
   * confused with "no NEW problems" — the difference matters to whoever reads
   * the log next.
   */
  baselined?: number;
}

const INFO_URI = REPO_URL;

export function render(result: CheckResult, format: Format, meta: RenderMeta = {}): string {
  const score = meta.score ?? computeScore(result);
  const baselined = meta.baselined ?? 0;
  switch (format) {
    case "json":
      return renderJson(result, score, baselined);
    case "github":
      return renderGithub(result, baselined);
    case "sarif":
      return renderSarif(result, meta);
    case "badge":
      return renderBadge(score);
    case "markdown":
      return renderMarkdown(result, score, baselined);
    default:
      return renderPretty(result, score, baselined);
  }
}

/** Rule metadata for tooling — the runnable rules plus the plugin-manifest checks. */
function ruleDescriptors(): RuleInfo[] {
  return catalog;
}


function renderJson(result: CheckResult, score: ScoreReport, baselined: number): string {
  return JSON.stringify(
    {
      version: 1,
      score: { score: score.score, grade: score.grade },
      summary: { ...result.summary, baselined },
      findings: result.findings.map(portableFinding),
    },
    null,
    2,
  );
}

/**
 * SARIF 2.1.0 — the interchange format GitHub Code Scanning ingests, so
 * findings land in the repo's Security tab with history and dedup. Pipe to a
 * file and hand it to github/codeql-action/upload-sarif.
 */
function renderSarif(result: CheckResult, meta: RenderMeta): string {
  const sarif = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "skillcheck",
            informationUri: INFO_URI,
            version: meta.version ?? "0.0.0",
            rules: ruleDescriptors().map((r) => ({
              id: r.id,
              name: r.id,
              shortDescription: { text: r.summary },
              fullDescription: { text: r.docs.why },
              // GitHub's Security tab renders `help` under each alert, so the
              // fix guidance travels with the finding instead of living in a
              // README the reader has to go find.
              help: { text: helpText(r.docs), markdown: helpMarkdown(r.id, r.docs) },
              helpUri: ruleDocUrl(r.id),
              properties: { tags: ["agent-skills", "skillcheck"] },
            })),
          },
        },
        results: result.findings.map((f) => ({
          ruleId: f.ruleId,
          level: f.severity, // "error" | "warning" are valid SARIF levels
          message: { text: f.detail ? `${f.message}\n\n${f.detail}` : f.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: toPosix(f.file) },
                region: { startLine: f.line ?? 1 },
              },
            },
          ],
        })),
      },
    ],
  };
  return JSON.stringify(sarif, null, 2);
}

/**
 * shields.io endpoint-badge JSON. Host the output at a raw URL and reference it
 * as `img.shields.io/endpoint?url=<raw-json>`. schemaVersion MUST be the number
 * 1; message is never empty; color is a shields named color mapped from grade.
 */
function renderBadge({ score, grade }: ScoreReport): string {
  return JSON.stringify({
    schemaVersion: 1,
    label: "skillcheck",
    message: `${score} (${grade})`,
    color: badgeColor(grade),
    labelColor: "grey",
    cacheSeconds: 300,
  });
}

function portableFinding(f: Finding) {
  return { ...f, file: toPosix(f.file) };
}

function renderGithub(result: CheckResult, baselined: number): string {
  // GitHub Actions workflow commands → inline PR annotations.
  const lines = result.findings.map((f) => {
    const kind = f.severity === "error" ? "error" : "warning";
    const file = toPosix(f.file);
    const line = f.line ?? 1;
    const message = escapeWorkflowData(`[${f.ruleId}] ${f.message}`);
    return `::${kind} file=${file},line=${line}::${message}`;
  });
  lines.push(summaryLine(result, false, baselined));
  return lines.join("\n");
}

function escapeWorkflowData(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** Markdown report — used for `--format markdown` and the GitHub step summary. */
function renderMarkdown(result: CheckResult, score: ScoreReport, baselined: number): string {
  const out: string[] = [];
  out.push("## skillcheck");
  out.push("");
  out.push(`**Skill health: ${score.score} (${score.grade})** — ${scoreScope(result, score)}`);
  out.push("");
  if (baselined > 0) {
    out.push(`_${baselined} pre-existing finding(s) accepted by the baseline and not shown._`);
    out.push("");
  }
  if (result.findings.length === 0) {
    out.push(`✔ ${scanned(result)} checked, ${baselined > 0 ? "no *new* problems" : "no problems found"}.`);
    return out.join("\n");
  }
  out.push("| | Rule | Location | Message |");
  out.push("| --- | --- | --- | --- |");
  for (const f of result.findings) {
    const icon = f.severity === "error" ? "✖ error" : "⚠ warning";
    const loc = `${displayPath(f.file)}:${f.line ?? 1}`;
    out.push(`| ${icon} | \`${f.ruleId}\` | ${loc} | ${mdCell(f.message)} |`);
  }
  return out.join("\n");
}

function mdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderPretty(result: CheckResult, score: ScoreReport, baselined: number): string {
  const out: string[] = [];
  const byFile = new Map<string, Finding[]>();
  for (const f of result.findings) {
    const list = byFile.get(f.file) ?? [];
    list.push(f);
    byFile.set(f.file, list);
  }

  for (const [file, findings] of byFile) {
    out.push(pc.underline(displayPath(file)));
    for (const f of findings) {
      const mark = f.severity === "error" ? pc.red("✖") : pc.yellow("⚠");
      const loc = f.line ? pc.dim(`:${f.line}`) : "";
      out.push(`  ${mark} ${f.message} ${pc.dim(`(${f.ruleId})`)}${loc}`);
      if (f.detail) out.push(pc.dim(`      ${f.detail}`));
    }
    out.push("");
  }

  out.push(summaryLine(result, true, baselined));
  out.push(scoreLine(score, true));
  return out.join("\n");
}

function scanned(result: CheckResult): string {
  const { skills, plugins } = result.summary;
  return `${skills} skill${skills === 1 ? "" : "s"}${plugins ? `, ${plugins} plugin manifest${plugins === 1 ? "" : "s"}` : ""}`;
}

function scoreScope(result: CheckResult, score: ScoreReport): string {
  const { errors, warnings } = result.summary;
  if (errors === 0 && warnings === 0) return `clean across ${scanned(result)}`;
  return `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"} across ${scanned(result)}`;
}

function scoreLine(score: ScoreReport, color: boolean): string {
  const msg = `Skill health: ${score.score}/100 (${score.grade})`;
  if (!color) return msg;
  const paint =
    score.grade === "A" || score.grade === "B"
      ? pc.green
      : score.grade === "F"
        ? pc.red
        : pc.yellow;
  return paint(msg);
}

/** Plain-text `help` for SARIF: why, then the corrected example. */
function helpText(docs: RuleDocs): string {
  return docs.good ? `${docs.why}\n\nCorrected example:\n${docs.good}` : docs.why;
}

function helpMarkdown(id: string, docs: RuleDocs): string {
  const out = [docs.why];
  if (docs.bad) out.push(`**Trips on**\n\n\`\`\`yaml\n${docs.bad}\n\`\`\``);
  if (docs.good) out.push(`**Passes**\n\n\`\`\`yaml\n${docs.good}\n\`\`\``);
  out.push(`Full reference: ${ruleDocUrl(id)}`);
  return out.join("\n\n");
}

const BAR_WIDTH = 20;

function bar(share: number): string {
  const filled = Math.max(1, Math.round(share * BAR_WIDTH));
  return "█".repeat(Math.min(filled, BAR_WIDTH)) + "░".repeat(Math.max(0, BAR_WIDTH - filled));
}

/**
 * `skillcheck why "<request>"` — the ranking, the terms that produced it, and
 * an explicit verdict. The disclaimer is part of the output, not a footnote in
 * the docs: this is a lexical simulation, and every reader should know that
 * without having to look it up.
 */
export function renderTrigger(
  report: TriggerReport,
  format: "pretty" | "json",
  index: TriggerIndex,
): string {
  if (format === "json") {
    return JSON.stringify(
      {
        version: 1,
        prompt: report.prompt,
        verdict: report.verdict,
        margin: Number(report.margin.toFixed(4)),
        coverage: Number(report.coverage.toFixed(4)),
        terms: report.terms,
        unmatchable: report.unmatchable,
        matches: report.matches.map((m) => ({
          name: m.name,
          file: toPosix(m.file),
          score: Number(m.score.toFixed(4)),
          share: Number(m.share.toFixed(4)),
          matched: m.matched,
        })),
        language: report.language.pack?.code ?? null,
        outOfLanguage: report.outOfLanguage,
      },
      null,
      2,
    );
  }

  const out: string[] = [];
  out.push(`${pc.dim("request")}  ${report.prompt}`);
  out.push(`${pc.dim("terms")}    ${report.terms.join(", ") || pc.dim("(none — all stopwords)")}`);
  out.push("");

  if (report.matches.length > 0) {
    const width = Math.min(28, Math.max(...report.matches.map((m) => displayWidth(m.name))));
    report.matches.slice(0, 8).forEach((m, i) => {
      const rank = pc.dim(`${i + 1}.`.padEnd(3));
      const name = padDisplay(m.name, width);
      const pct = `${Math.round(m.share * 100)}%`.padStart(4);
      const painted = i === 0 ? pc.bold(name) : name;
      out.push(`  ${rank} ${painted}  ${pc.dim(bar(m.share))} ${pct}  ${pc.dim(m.matched.join(" "))}`);
    });
    out.push("");
  }

  const top = report.matches[0];
  const second = report.matches[1];
  if (report.verdict === "none") {
    out.push(
      pc.yellow(
        top
          ? `  ✖ no skill covers this request — best match ${top.name} caught only ${top.matched.length} of ${report.terms.length} terms`
          : "  ✖ no skill matched a single term of this request",
      ),
    );
  } else if (report.verdict === "close" && second && top) {
    const others = report.contenders.length - 2;
    const alsoTied = others > 0 ? `, and ${plural(others, "other skill")} within the same margin` : "";
    out.push(
      pc.yellow(
        `  ⚠ coin flip — ${top.name} leads ${second.name} by only ${Math.round(report.margin * 100)}%${alsoTied}`,
      ),
    );
  } else if (top) {
    const lead = second ? ` by ${Math.round(report.margin * 100)}%` : " (only candidate)";
    out.push(pc.green(`  ✔ clear — ${top.name} wins${lead}`));
  }

  /**
   * Words the repo has no vocabulary for.
   *
   * Coverage is measured over the terms that *could* match (see match.ts), which
   * is what stops a naturally-phrased request from being reported as reaching
   * nothing. The honest cost of that choice is that a winner can look confident
   * on thin evidence, so the evidence is printed: `matched 1 of 4` next to the
   * three words nothing here uses is a reader's cue to judge for themselves.
   */
  if (top && report.unmatchable.length > 0) {
    out.push(
      pc.dim(
        `    matched ${top.matched.length} of ${report.terms.length} terms — ` +
          `${report.unmatchable.join(", ")} occur${report.unmatchable.length === 1 ? "s" : ""} in no skill here`,
      ),
    );
  }

  /**
   * On a coin flip, the words behind it.
   *
   * The verdict alone stops one sentence short of an action: two skills tie at
   * 7%, and the author is left to guess which word did it. Both lines below are
   * facts about text the author wrote, not advice — and the second is the one
   * that matters, because a contender with nothing of its own cannot be
   * separated by any rewording at all.
   */
  if (report.verdict === "close") {
    const { shared, only } = contenderTerms(index, report.contenders);
    if (shared.length > 0) {
      out.push(pc.dim(`    their descriptions tie on: ${shared.slice(0, 6).join(", ")}`));
    }
    for (const contender of report.contenders) {
      const own = only.get(contender.file) ?? [];
      out.push(
        pc.dim(
          own.length > 0
            ? `    only ${contender.name}: ${own.slice(0, 5).join(", ")}`
            : `    only ${contender.name}: ${pc.yellow("nothing its description does not share with a rival")}`,
        ),
      );
    }
  }

  // A thin result in a multilingual repo has two very different causes, and the
  // ranking alone cannot tell them apart: the wording may be weak, or the skill
  // that would have answered may simply be described in another language, where
  // no term could ever match. Saying which skills were never in the running
  // turns "no skill covers this" into a question the reader can act on.
  //
  // The trigger is "much of this request reached nothing", not only the `none`
  // verdict. A request can now find a clear winner while most of its words land
  // nowhere — and that is exactly the shape of asking in the wrong language, so
  // tying the note to `none` alone would have hidden it in the case it was
  // written for.
  const mostlyUnreached =
    report.verdict === "none" || report.unmatchable.length * 2 >= report.terms.length;
  if (mostlyUnreached && report.outOfLanguage.length > 0) {
    const total = report.outOfLanguage.reduce((sum, entry) => sum + entry.count, 0);
    const breakdown = report.outOfLanguage.map((e) => `${e.label} ${e.count}`).join(", ");
    const s = total === 1 ? "" : "s";
    out.push(
      pc.dim(
        wrap(
          `${total} skill${s} here ${total === 1 ? "is" : "are"} described in another language, ` +
            `so no term in ${total === 1 ? "it" : "them"} could match a request in ` +
            `${describeLanguage(report.language)}: ${breakdown}. Ask in that language, or give ` +
            `${total === 1 ? "it" : "them"} a term that survives translation — see the ` +
            "cross-language-trigger rule.",
          82,
          "    ",
        ),
      ),
    );
  }
  out.push("");
  out.push(
    pc.dim(
      "  BM25 over each skill's name + description. A deterministic model of the retrieval\n" +
        "  step, not a prediction of the model's choice — read a near-tie as a real risk and a\n" +
        "  clear win as \"nothing in your wording is working against you\".",
    ),
  );
  return out.join("\n");
}

// ────────────────────────────────────────────────────────────── diff ─────────

/**
 * How each kind of drift is presented.
 *
 * Grouped by kind rather than listed flat, because the *kind* is the finding: a
 * reviewer needs to know in one glance whether a request moved somewhere they
 * were looking or somewhere they weren't. The headings say what the group means
 * so nobody has to hold the vocabulary in their head.
 */
const DRIFT_SECTIONS: ReadonlyArray<{
  kind: DriftKind;
  heading: string;
  gloss: string;
  mark: "error" | "warning" | "note";
}> = [
  {
    kind: "collateral",
    heading: "changed hands",
    gloss: "a request now reaches a different skill, and not one you were editing",
    mark: "error",
  },
  {
    kind: "lost",
    heading: "no longer reaches anything",
    gloss: "a request that used to find a skill now matches none of them",
    mark: "error",
  },
  {
    kind: "narrowed",
    heading: "lead narrowed",
    gloss: "the same skill still wins, by a margin that is no longer safe",
    mark: "warning",
  },
  {
    kind: "intended",
    heading: "changed where you were editing",
    gloss: "the expected consequence of the descriptions you changed — check it is what you meant",
    mark: "note",
  },
  {
    kind: "gained",
    heading: "newly claimed",
    gloss: "a request nothing used to match now reaches a skill",
    mark: "note",
  },
];

function driftMark(mark: "error" | "warning" | "note"): string {
  if (mark === "error") return pc.red("✖");
  if (mark === "warning") return pc.yellow("⚠");
  return pc.dim("·");
}

/** Where a probe's words came from — printed, because it changes their weight. */
function probeOrigin(drift: ProbeDrift): string {
  if (drift.probe.source === "scenario") return "your scenarios file";
  return `${drift.probe.owner}'s own description`;
}

/**
 * `skillcheck diff <ref>` — what a change did to which skill wins.
 *
 * The summary line is written so that the *clean* case still says something
 * worth reading. "No request changes hands, across 41 probes" is the reassurance
 * a reviewer actually wants, and a diff tool that prints nothing when nothing
 * broke teaches people it isn't running.
 */
export function renderDrift(
  report: DriftReport,
  format: "pretty" | "json" | "markdown" | "github",
): string {
  if (format === "json") return renderDriftJson(report);
  if (format === "markdown") return renderDriftMarkdown(report);
  if (format === "github") return renderDriftGithub(report);

  const out: string[] = [];
  out.push(`${pc.dim("comparing against")} ${pc.bold(report.ref)}`);
  out.push(
    pc.dim(
      `  ${plural(report.skillsBefore, "skill")} there · ${report.skillsAfter} here${changeSummary(report)}`,
    ),
  );
  out.push("");

  for (const section of DRIFT_SECTIONS) {
    const group = report.drifts.filter((d) => d.kind === section.kind);
    if (group.length === 0) continue;
    out.push(`${pc.bold(section.heading)} ${pc.dim(`— ${section.gloss}`)}`);
    for (const drift of group) {
      out.push(`  ${driftMark(section.mark)} ${JSON.stringify(drift.probe.label)}  ${pc.dim(probeOrigin(drift))}`);
      out.push(`      ${drift.detail}`);
    }
    out.push("");
  }

  const introduced = report.findings.filter((f) => f.status === "new");
  if (introduced.length > 0) {
    out.push(
      `${pc.bold("findings this change introduced")} ${pc.dim("— everything already broken is left out")}`,
    );
    for (const entry of introduced) {
      const mark = entry.severity === "error" ? pc.red("✖") : pc.yellow("⚠");
      const where = entry.collateral ? pc.dim(" — on a skill you didn't edit") : "";
      out.push(`  ${mark} ${displayPath(entry.file)}${where}`);
      out.push(`      ${entry.message} ${pc.dim(`(${entry.ruleId})`)}`);
    }
    out.push("");
  }
  const resolved = report.findings.filter((f) => f.status === "fixed");
  if (resolved.length > 0) {
    out.push(pc.green(`${pc.bold("fixed")}`) + pc.dim(" — findings that were here at the ref and aren't now"));
    for (const entry of resolved) {
      out.push(`  ${pc.green("✔")} ${displayPath(entry.file)}  ${pc.dim(entry.ruleId)}`);
    }
    out.push("");
  }

  out.push(driftSummaryLine(report, true));
  out.push(
    pc.dim(
      `  ${plural(report.probes.total, "probe")}: ${report.probes.scenarios} from your scenarios file, ` +
        `${report.probes.descriptions} from your own descriptions. Same BM25 ranking as \`why\`, run twice.`,
    ),
  );
  return out.join("\n");
}

/** `1 skill` / `2 skills` — the tool's output is read by people, and screenshotted. */
function plural(n: number, noun: string, suffix = "s"): string {
  return `${n} ${noun}${n === 1 ? "" : suffix}`;
}

/** `· 1 added, 2 retriggered` — only the parts that happened. */
function changeSummary(report: DriftReport): string {
  const counts = new Map<string, number>();
  for (const change of report.changes) counts.set(change.kind, (counts.get(change.kind) ?? 0) + 1);
  const parts = [...counts].map(([kind, n]) => `${n} ${kind}`);
  return parts.length ? ` · ${parts.join(", ")}` : " · nothing decisive changed";
}

function driftCounts(report: DriftReport) {
  const of = (kind: DriftKind) => report.drifts.filter((d) => d.kind === kind).length;
  return {
    collateral: of("collateral"),
    lost: of("lost"),
    narrowed: of("narrowed"),
    intended: of("intended"),
    gained: of("gained"),
  };
}

function driftSummaryLine(report: DriftReport, color: boolean): string {
  const counts = driftCounts(report);
  const changed = counts.collateral + counts.lost;
  const introduced = report.findings.filter((f) => f.status === "new");
  const errors = introduced.filter((f) => f.severity === "error").length;
  const resolved = report.findings.filter((f) => f.status === "fixed").length;

  const parts: string[] = [];
  if (changed > 0) parts.push(`${plural(changed, "request")} changed hands unexpectedly`);
  if (counts.narrowed > 0) parts.push(`${plural(counts.narrowed, "lead")} narrowed`);
  if (counts.intended > 0) parts.push(`${plural(counts.intended, "intended change")} where you were editing`);
  if (counts.gained > 0) parts.push(`${plural(counts.gained, "request")} newly claimed`);
  if (introduced.length > 0) parts.push(`${plural(introduced.length, "new finding")}`);
  if (resolved > 0) parts.push(`${resolved} fixed`);

  if (parts.length === 0) {
    const msg = `✔ no request changes hands — ${plural(report.probes.total, "probe")} rank the same either side`;
    return color ? pc.green(msg) : msg;
  }
  const msg = parts.join(", ");
  if (!color) return msg;
  return changed > 0 || errors > 0 ? pc.red(pc.bold(msg)) : pc.yellow(msg);
}

function renderDriftJson(report: DriftReport): string {
  return JSON.stringify(
    {
      version: 1,
      ref: report.ref,
      skills: { before: report.skillsBefore, after: report.skillsAfter },
      probes: report.probes,
      changes: report.changes.map((c) => ({ ...c, file: toPosix(c.file) })),
      drifts: report.drifts.map((d) => ({
        kind: d.kind,
        prompt: d.probe.prompt,
        source: d.probe.source,
        owner: d.probe.owner ?? null,
        before: d.before,
        after: d.after,
        marginBefore: Number(d.marginBefore.toFixed(4)),
        marginAfter: Number(d.marginAfter.toFixed(4)),
        detail: d.detail,
      })),
      findings: report.findings.map((f) => ({ ...f, file: toPosix(f.file) })),
    },
    null,
    2,
  );
}

/**
 * Workflow commands, so drift lands as an inline annotation on the description
 * that caused it — the line a reviewer is already looking at.
 */
function renderDriftGithub(report: DriftReport): string {
  const lines: string[] = [];
  for (const section of DRIFT_SECTIONS) {
    for (const drift of report.drifts.filter((d) => d.kind === section.kind)) {
      const kind = section.mark === "error" ? "error" : section.mark === "warning" ? "warning" : "notice";
      const message = escapeWorkflowData(
        `[activation-drift] ${JSON.stringify(drift.probe.label)} — ${drift.detail}`,
      );
      lines.push(`::${kind}::${message}`);
    }
  }
  for (const entry of report.findings.filter((f) => f.status === "new")) {
    const kind = entry.severity === "error" ? "error" : "warning";
    lines.push(
      `::${kind} file=${toPosix(entry.file)},line=1::${escapeWorkflowData(
        `[${entry.ruleId}] ${entry.message}${entry.collateral ? " (introduced here, on a skill this change did not edit)" : " (introduced here)"}`,
      )}`,
    );
  }
  lines.push(driftSummaryLine(report, false));
  return lines.join("\n");
}

/** Markdown, for the job summary and for pasting into a pull request. */
function renderDriftMarkdown(report: DriftReport): string {
  const out: string[] = [];
  out.push("## skillcheck — activation drift");
  out.push("");
  out.push(
    `Compared against \`${report.ref}\`: **${report.skillsBefore}** skill(s) there, **${report.skillsAfter}** here.`,
  );
  out.push("");
  if (report.drifts.length === 0 && report.findings.length === 0) {
    out.push(
      `✔ No request changes hands. ${plural(report.probes.total, "probe")} — ${report.probes.scenarios} from the scenarios file, ${report.probes.descriptions} from the skills' own descriptions — rank the same either side.`,
    );
    return out.join("\n");
  }

  out.push("| | Request | From | What changed |");
  out.push("| --- | --- | --- | --- |");
  for (const section of DRIFT_SECTIONS) {
    for (const drift of report.drifts.filter((d) => d.kind === section.kind)) {
      const icon = section.mark === "error" ? "✖" : section.mark === "warning" ? "⚠" : "·";
      out.push(
        `| ${icon} ${section.heading} | ${mdCell(drift.probe.label)} | ${mdCell(probeOrigin(drift))} | ${mdCell(drift.detail)} |`,
      );
    }
  }
  for (const entry of report.findings) {
    const icon =
      entry.status === "fixed" ? "✔ fixed" : entry.severity === "error" ? "✖ new error" : "⚠ new warning";
    const where =
      entry.status === "new" && entry.collateral ? "a skill this change did not edit" : "this change";
    out.push(
      `| ${icon} | ${mdCell(displayPath(entry.file))} | ${where} | ${mdCell(`${entry.message} (\`${entry.ruleId}\`)`)} |`,
    );
  }
  out.push("");
  out.push(`**${driftSummaryLine(report, false)}**`);
  return out.join("\n");
}

/** `skillcheck test` — scenario results, one line each. */
export function renderScenarioResults(
  results: readonly ScenarioResult[],
  format: "pretty" | "json",
): string {
  if (format === "json") {
    return JSON.stringify(
      {
        // 2: `expect` became a list and `forbid` was added. Consumers that read
        // `expect` as a string want to key off this.
        version: 2,
        summary: {
          total: results.length,
          passed: results.filter((r) => r.status === "pass").length,
          close: results.filter((r) => r.status === "close").length,
          failed: results.filter((r) => r.status === "fail").length,
        },
        scenarios: results.map((r) => ({
          prompt: r.scenario.prompt,
          expect: r.scenario.expectNone ? "none" : r.scenario.expect,
          forbid: r.scenario.forbid,
          actual: r.actual,
          status: r.status,
          reason: r.reason,
          margin: Number(r.report.margin.toFixed(4)),
        })),
      },
      null,
      2,
    );
  }

  const out: string[] = [];
  for (const r of results) {
    const mark = r.status === "pass" ? pc.green("✔") : r.status === "close" ? pc.yellow("⚠") : pc.red("✖");
    out.push(`  ${mark} ${JSON.stringify(r.scenario.prompt)}`);
    const arrow = r.actual ?? "no skill";
    out.push(
      r.status === "pass"
        ? pc.dim(`      → ${arrow}`)
        : pc.dim(`      → ${arrow} — ${r.reason ?? ""}`),
    );
  }
  out.push("");

  const passed = results.filter((r) => r.status === "pass").length;
  const close = results.filter((r) => r.status === "close").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const parts = [`${passed} passed`];
  if (close) parts.push(`${close} too close to call`);
  if (failed) parts.push(`${failed} failed`);
  const line = `${parts.join(", ")} (${results.length} scenario${results.length === 1 ? "" : "s"})`;
  out.push(failed ? pc.red(pc.bold(line)) : close ? pc.yellow(line) : pc.green(line));
  return out.join("\n");
}

/** `skillcheck explain <rule>` — the rule's own docs, straight from source. */
export function renderExplain(rule: RuleInfo): string {
  const out: string[] = [];
  out.push(`${pc.bold(rule.id)}${rule.fixable ? pc.dim("  (fixable with --fix)") : ""}`);
  out.push(`  ${rule.summary}`);
  out.push("");
  out.push(pc.bold("Why it matters"));
  out.push(wrap(rule.docs.why, 76, "  "));
  if (rule.docs.bad) {
    out.push("");
    out.push(pc.bold("Trips on"));
    out.push(indent(rule.docs.bad, "  "));
  }
  if (rule.docs.good) {
    out.push("");
    out.push(pc.bold("Passes"));
    out.push(indent(rule.docs.good, "  "));
  }
  if (rule.options?.length) {
    out.push("");
    out.push(pc.bold("Options"));
    for (const opt of rule.options) {
      out.push(`  ${opt.name} ${pc.dim(`(${opt.type}, default ${JSON.stringify(opt.default)})`)}`);
      out.push(wrap(opt.description, 72, "    "));
    }
  }
  out.push("");
  out.push(pc.bold("Turn it off"));
  out.push(`  ${pc.dim("skillcheck.config.json")}   { "rules": { "${rule.id}": "off" } }`);
  out.push(`  ${pc.dim("one skill only")}           x-skillcheck: { disable: [${rule.id}] }`);
  out.push("");
  out.push(pc.dim(`  ${ruleDocUrl(rule.id)}`));
  return out.join("\n");
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function wrap(text: string, width: number, prefix: string): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    // Measured in columns, not code units: a wrapped line containing a CJK
    // language label or skill name is half as long as `.length` claims.
    if (line && displayWidth(line) + displayWidth(word) + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => `${prefix}${l}`).join("\n");
}

function summaryLine(result: CheckResult, color: boolean, baselined = 0): string {
  const { errors, warnings } = result.summary;
  const scope = scanned(result);
  if (errors === 0 && warnings === 0) {
    const msg =
      baselined > 0
        ? `✔ ${scope} checked, no NEW problems (${baselined} accepted by the baseline)`
        : `✔ ${scope} checked, no problems found`;
    return color ? pc.green(msg) : msg;
  }
  const msg = `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"} (${scope} checked)`;
  if (!color) return msg;
  return errors > 0 ? pc.red(pc.bold(msg)) : pc.yellow(msg);
}

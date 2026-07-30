import pc from "picocolors";
import type { BudgetLine, BudgetReport } from "./budget.js";
import type {
  DriftKind,
  DriftReport,
  ProbeDrift,
  ScenarioContractChange,
} from "./drift.js";
import { describeLanguage } from "./languages/index.js";
import { contenderTerms, type TriggerIndex, type TriggerReport } from "./match.js";
import { REPO_URL, ruleDocUrl } from "./meta.js";
import { displayPath, toPosix } from "./paths.js";
import { catalog } from "./rules/index.js";
import { displayWidth, padDisplay } from "./script.js";
import {
  describeExpectation,
  normalizeScenarioContract,
  type Scenario,
  type ScenarioCoverage,
  type ScenarioResult,
} from "./scenarios.js";
import { badgeColor, computeScore, type ScoreReport } from "./score.js";
import type { CheckResult, Finding, RuleDocs, RuleInfo } from "./types.js";

export type Format = "pretty" | "json" | "github" | "sarif" | "badge" | "markdown" | "junit";

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
    case "junit":
      return renderJunit(result);
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

// ─────────────────────────────────────────────────────────── JUnit ──────────

/**
 * JUnit XML — what every CI system that isn't GitHub reads.
 *
 * GitLab, Jenkins, CircleCI, Buildkite and Azure Pipelines all ingest this and
 * nothing else, so without it skillcheck's findings are a wall of log text
 * everywhere except one host. The mapping is the one linters have converged on:
 * a scanned unit is a suite, a finding is a failing case, and a unit with no
 * findings is a passing case — the last part matters, because a report holding
 * only failures makes a repo look like it has four skills instead of forty.
 *
 * Not offered for `diff`. A JUnit consumer keys history on the case name, and a
 * drift probe's name is derived from whatever text exists at two revisions —
 * so the history it accumulated would be noise about cases that never recur.
 */

/**
 * XML 1.0 has no escape for most control characters — they are forbidden in a
 * document at all, so a parser rejects the whole file rather than the one
 * attribute that carried one. They are dropped before escaping, because a
 * report nobody can open is worse than one missing a byte nobody can see.
 */
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

function xmlText(s: string): string {
  return s
    .replace(XML_FORBIDDEN, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * An attribute value additionally escapes `"`, and has its newlines collapsed.
 *
 * XML attribute-value normalization turns a literal newline into a space at
 * parse time, so emitting one means the case name a consumer reads back is not
 * the name that was written. A multi-line scenario prompt is legal YAML, so
 * this is reachable; collapsing here makes the two agree.
 */
function xmlAttr(s: string): string {
  return xmlText(s.replace(/\s+/g, " ").trim()).replace(/"/g, "&quot;");
}

function renderJunit(result: CheckResult): string {
  const units = [
    ...(result.files.skills ?? []),
    ...(result.files.plugins ?? []),
    ...(result.files.contexts ?? []),
  ];
  const byFile = new Map<string, Finding[]>();
  for (const file of units) byFile.set(file, []);
  for (const f of result.findings) {
    // A finding on a file that was not itself a scanned unit still has to be
    // reported; losing it would make a green suite untrue.
    const list = byFile.get(f.file) ?? [];
    list.push(f);
    byFile.set(f.file, list);
  }

  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  const failures = result.findings.length;
  const cases = [...byFile.values()].reduce((n, list) => n + Math.max(1, list.length), 0);
  out.push(
    `<testsuites name="skillcheck" tests="${cases}" failures="${failures}" errors="0" skipped="0">`,
  );

  for (const [file, findings] of byFile) {
    const name = xmlAttr(displayPath(file));
    out.push(
      `  <testsuite name="${name}" tests="${Math.max(1, findings.length)}" failures="${findings.length}" errors="0" skipped="0">`,
    );
    if (findings.length === 0) {
      out.push(`    <testcase name="skillcheck" classname="${name}" />`);
    }
    for (const f of findings) {
      // Consumers key history on (classname, name), so two findings from one
      // rule in one file need distinct names or the second is dropped. The
      // line is the only thing that separates them and the only thing a reader
      // wants next to the rule id anyway.
      const line = f.line ?? 1;
      const caseName = findings.filter((o) => o.ruleId === f.ruleId).length > 1
        ? `${f.ruleId}:${line}`
        : f.ruleId;
      out.push(`    <testcase name="${xmlAttr(caseName)}" classname="${name}">`);
      out.push(
        `      <failure type="${xmlAttr(f.severity)}" message="${xmlAttr(f.message)}">` +
          xmlText(`${displayPath(f.file)}:${line}\n${f.message}${f.detail ? `\n\n${f.detail}` : ""}`) +
          "</failure>",
      );
      out.push("    </testcase>");
    }
    out.push("  </testsuite>");
  }

  out.push("</testsuites>");
  return out.join("\n");
}

/** `skillcheck test` as JUnit: a scenario is already a test case. */
function renderScenarioJunit(results: readonly ScenarioResult[], source?: string): string {
  const suite = xmlAttr(source ? displayPath(source) : "skillcheck.scenarios");
  const { failed } = scenarioCounts(results);
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  out.push(
    `<testsuites name="skillcheck trigger scenarios" tests="${results.length}" failures="${failed}" errors="0" skipped="0">`,
  );
  out.push(
    `  <testsuite name="${suite}" tests="${results.length}" failures="${failed}" errors="0" skipped="0">`,
  );
  for (const r of results) {
    const name = xmlAttr(r.scenario.prompt);
    const expectation = describeExpectation(r.scenario);
    if (r.status === "pass") {
      out.push(`    <testcase name="${name}" classname="${suite}" />`);
      continue;
    }
    out.push(`    <testcase name="${name}" classname="${suite}">`);
    if (r.status === "fail") {
      out.push(
        `      <failure type="scenario" message="${xmlAttr(r.reason ?? "failed")}">` +
          xmlText(`expected ${expectation}\nreached ${r.actual ?? "no skill"}\n${r.reason ?? ""}`) +
          "</failure>",
      );
    } else if (r.status === "close") {
      // Passing, but for reasons too thin to depend on. `system-out` keeps that
      // visible without turning a warning into a red build.
      out.push(`      <system-out>${xmlText(r.reason ?? "too close to call")}</system-out>`);
    }
    out.push("    </testcase>");
  }
  out.push("  </testsuite>", "</testsuites>");
  return out.join("\n");
}

function renderGithub(result: CheckResult, baselined: number): string {
  // GitHub Actions workflow commands → inline PR annotations.
  const lines = result.findings.map((f) => {
    const kind = f.severity === "error" ? "error" : "warning";
    const file = escapeWorkflowProperty(toPosix(f.file));
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

/** GitHub command properties additionally reserve `:` and `,`. */
function escapeWorkflowProperty(s: string): string {
  return escapeWorkflowData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
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
  const { skills, plugins, contexts } = result.summary;
  const parts: string[] = [];
  // "0 skills, 1 context file" is a true sentence that reads like a bug. The
  // skills count is only dropped when something else was actually scanned —
  // a run that found nothing at all still has to say so.
  if (skills > 0 || (!plugins && !contexts)) {
    parts.push(`${skills} skill${skills === 1 ? "" : "s"}`);
  }
  if (plugins) parts.push(`${plugins} plugin manifest${plugins === 1 ? "" : "s"}`);
  if (contexts) parts.push(`${contexts} context file${contexts === 1 ? "" : "s"}`);
  return parts.join(", ");
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

// ────────────────────────────────────────────────────────── budget ──────────

/** Skills listed before the tail is folded into one line. See {@link renderBudget}. */
const BUDGET_ROWS = 15;

/**
 * `skillcheck budget` — what the repo's instructions occupy before anyone asks
 * for anything, and what each skill adds on top when it fires.
 *
 * Every number is labelled an estimate, in the output rather than in the docs,
 * because it is one: skillcheck never calls a tokenizer API. See src/tokens.ts
 * for what the estimate is made of and src/budget.ts for why the two halves are
 * reported apart.
 */
export function renderBudget(report: BudgetReport, format: "pretty" | "json"): string {
  if (format === "json") {
    const portable = (line: BudgetLine) => (line.file ? { ...line, file: toPosix(line.file) } : line);
    return JSON.stringify(
      {
        version: 1,
        estimate: "offline, script-aware; see docs/rules.md#context-size",
        always: report.always.map(portable),
        alwaysTotal: report.alwaysTotal,
        nested: report.nested.map(portable),
        perSkill: report.perSkill.map((entry) => ({ ...entry, file: toPosix(entry.file) })),
        skills: report.skills,
      },
      null,
      2,
    );
  }

  const out: string[] = [];
  const ALWAYS = "always";
  const FIRES = "when it fires";
  const labels = [
    ...report.always.map((l) => l.label),
    ...report.nested.map((l) => l.label),
    ...report.perSkill.map((s) => s.name),
    "total",
    "Per skill",
  ];
  const labelWidth = Math.max(20, ...labels.map(displayWidth));
  const amounts = [
    ...report.always.map((l) => l.tokens),
    ...report.nested.map((l) => l.tokens),
    ...report.perSkill.flatMap((s) => [s.description, s.body]),
    report.alwaysTotal,
  ];
  const numberWidth = Math.max(ALWAYS.length, ...amounts.map((n) => tokenText(n).length));
  const row = (label: string, tokens: number) =>
    `  ${padDisplay(label, labelWidth)}  ${tokenText(tokens).padStart(numberWidth)}`;

  if (report.always.length > 0) {
    out.push(pc.bold("Always in context"));
    out.push(pc.dim("  loaded before the user's first word, carried by every request in the session"));
    out.push("");
    // A total under a single row is arithmetic nobody needs; the unit still has
    // to appear, so it rides along with whichever row is the last one.
    if (report.always.length === 1) {
      out.push(pc.bold(`${row(report.always[0].label, report.always[0].tokens)} tokens`));
    } else {
      for (const line of report.always) out.push(row(line.label, line.tokens));
      out.push(`  ${" ".repeat(labelWidth)}  ${"─".repeat(numberWidth)}`);
      out.push(pc.bold(`${row("total", report.alwaysTotal)} tokens`));
    }
    out.push("");
  }

  if (report.nested.length > 0) {
    out.push(pc.bold("Read while the agent works in that directory"));
    out.push("");
    for (const line of report.nested) out.push(row(line.label, line.tokens));
    out.push("");
  }

  /**
   * Both columns together, dearest always-on first.
   *
   * The aggregate above answers "how much", and stops there — which leaves the
   * only actionable question unanswered. This column is the answer: it names
   * the description taxing every request, next to the body that is the thing
   * people already think of as the expensive part.
   */
  if (report.perSkill.length > 0) {
    out.push(
      pc.bold(padDisplay("Per skill", labelWidth + 2)) +
        pc.dim(`${ALWAYS.padStart(numberWidth)}   ${FIRES}`),
    );
    out.push("");
    for (const skill of report.perSkill.slice(0, BUDGET_ROWS)) {
      out.push(`${row(skill.name, skill.description)}   ${tokenText(skill.body).padStart(FIRES.length)}`);
    }
    const rest = report.perSkill.slice(BUDGET_ROWS);
    if (rest.length > 0) {
      const restDescriptions = rest.reduce((sum, s) => sum + s.description, 0);
      const restBodies = rest.reduce((sum, s) => sum + s.body, 0);
      out.push(
        pc.dim(
          `${row(`… ${rest.length} more`, restDescriptions)}   ${tokenText(restBodies).padStart(FIRES.length)}`,
        ),
      );
      out.push(pc.dim("  (--format json lists every one)"));
    }
    out.push("");
  }

  out.push(
    pc.dim(
      "Estimated offline and script-aware — roughly 4 characters per token in Latin\n" +
        "text, 1 in Han. A description is what the model reads to choose a skill, so it\n" +
        "is in context whether or not the skill fires; a body is what it reads after\n" +
        "choosing. Keeping a skill costs the first, using it the second.",
    ),
  );
  return out.join("\n");
}

/** `~1,240` — the tilde is part of the number, because the number is a guess. */
function tokenText(tokens: number): string {
  return `~${tokens.toLocaleString("en-US")}`;
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
    kind: "regressed",
    heading: "scenario regressed",
    gloss: "a checked-in activation contract passed there and fails here",
    mark: "error",
  },
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
    kind: "repaired",
    heading: "scenario repaired",
    gloss: "a checked-in activation contract that failed there passes here",
    mark: "note",
  },
  {
    kind: "allowed",
    heading: "allowed by scenario",
    gloss: "the winner changed, but both outcomes satisfy the checked-in contract",
    mark: "note",
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

  appendPrettyScenarioChanges(out, scenarioChangesOf(report));

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
    regressed: of("regressed"),
    collateral: of("collateral"),
    lost: of("lost"),
    narrowed: of("narrowed"),
    repaired: of("repaired"),
    allowed: of("allowed"),
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
  const skipped = scenarioChangesOf(report).length;

  const parts: string[] = [];
  if (counts.regressed > 0) parts.push(`${plural(counts.regressed, "scenario")} regressed`);
  if (changed > 0) parts.push(`${plural(changed, "request")} changed hands unexpectedly`);
  if (counts.narrowed > 0) parts.push(`${plural(counts.narrowed, "lead")} narrowed`);
  if (counts.repaired > 0) parts.push(`${plural(counts.repaired, "scenario")} repaired`);
  if (counts.allowed > 0) parts.push(`${plural(counts.allowed, "allowed change")}`);
  if (counts.intended > 0) parts.push(`${plural(counts.intended, "intended change")} where you were editing`);
  if (counts.gained > 0) parts.push(`${plural(counts.gained, "request")} newly claimed`);
  if (introduced.length > 0) parts.push(`${plural(introduced.length, "new finding")}`);
  if (resolved > 0) parts.push(`${resolved} fixed`);
  if (skipped > 0) parts.push(`${plural(skipped, "scenario contract")} not compared`);

  if (parts.length === 0) {
    const msg = `✔ no request changes hands — ${plural(report.probes.total, "probe")} rank the same either side`;
    return color ? pc.green(msg) : msg;
  }
  const msg = parts.join(", ");
  if (!color) return msg;
  return counts.regressed > 0 || changed > 0 || errors > 0
    ? pc.red(pc.bold(msg))
    : pc.yellow(msg);
}

function renderDriftJson(report: DriftReport): string {
  return JSON.stringify(
    {
      version: 2,
      ref: report.ref,
      skills: { before: report.skillsBefore, after: report.skillsAfter },
      probes: report.probes,
      scenarioContracts: {
        compared: report.probes.scenarios,
        skipped: scenarioChangesOf(report).map((change) => ({
          kind: change.kind,
          before: change.before ? portableScenarioContract(change.before) : null,
          after: change.after ? portableScenarioContract(change.after) : null,
        })),
      },
      changes: report.changes.map((c) => ({ ...c, file: toPosix(c.file) })),
      drifts: report.drifts.map((d) => ({
        kind: d.kind,
        prompt: d.probe.prompt,
        source: d.probe.source,
        owner: d.probe.owner ?? null,
        contract: d.probe.scenario ? portableScenarioAssertion(d.probe.scenario) : null,
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
  for (const change of scenarioChangesOf(report)) {
    lines.push(
      `::notice::${escapeWorkflowData(
        `[scenario-contract] ${JSON.stringify(scenarioChangePrompt(change))} — ${scenarioChangeLabel(change)} and was not compared; ${scenarioChangeFollowup(change)}`,
      )}`,
    );
  }
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
      `::${kind} file=${escapeWorkflowProperty(toPosix(entry.file))},line=1::${escapeWorkflowData(
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
  appendMarkdownScenarioChanges(out, scenarioChangesOf(report));
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

function portableScenarioAssertion(scenario: Scenario): {
  expect: string | string[];
  forbid: string[];
} {
  const normalized = normalizeScenarioContract(scenario);
  return {
    expect: normalized.expectNone ? "none" : normalized.expect,
    forbid: normalized.forbid,
  };
}

/** Preserve source compatibility for callers constructing pre-v2 report objects. */
function scenarioChangesOf(report: DriftReport): readonly ScenarioContractChange[] {
  return report.scenarioChanges ?? [];
}

function portableScenarioContract(scenario: Scenario): {
  prompt: string;
  expect: string | string[];
  forbid: string[];
} {
  const normalized = normalizeScenarioContract(scenario);
  return { prompt: normalized.prompt, ...portableScenarioAssertion(normalized) };
}

function scenarioChangePrompt(change: ScenarioContractChange): string {
  return change.kind === "removed" ? change.before.prompt : change.after.prompt;
}

function scenarioChangeLabel(change: ScenarioContractChange): string {
  if (change.kind === "added") return "scenario added";
  if (change.kind === "removed") return "scenario assertion removed";
  return "scenario assertion changed";
}

function scenarioChangeFollowup(change: ScenarioContractChange): string {
  return change.kind === "removed"
    ? "review the removal to confirm that coverage was intentionally dropped"
    : "skillcheck test checks the current assertion";
}

function appendPrettyScenarioChanges(
  out: string[],
  changes: readonly ScenarioContractChange[],
): void {
  if (changes.length === 0) return;
  out.push(
    `${pc.bold("scenario contracts not compared")} ${pc.dim("— no identical assertion exists on both revisions")}`,
  );
  for (const change of changes) {
    out.push(`  ${pc.dim("·")} ${JSON.stringify(scenarioChangePrompt(change))}  ${scenarioChangeLabel(change)}`);
    if (change.kind === "changed") {
      out.push(
        pc.dim(
          `      ${describeExpectation(change.before)} → ${describeExpectation(change.after)}; ${scenarioChangeFollowup(change)}.`,
        ),
      );
    } else {
      const contract = change.kind === "removed" ? change.before : change.after;
      out.push(pc.dim(`      ${describeExpectation(contract)}; ${scenarioChangeFollowup(change)}.`));
    }
  }
  out.push("");
}

function appendMarkdownScenarioChanges(
  out: string[],
  changes: readonly ScenarioContractChange[],
): void {
  if (changes.length === 0) return;
  out.push("### Scenario contracts not compared", "");
  out.push("No identical assertion exists on both revisions, so these are named for review instead of being assigned a historical result.", "");
  out.push("| Change | Request | Before | Now |", "| --- | --- | --- | --- |");
  for (const change of changes) {
    out.push(
      `| ${scenarioChangeLabel(change)} | ${mdCell(scenarioChangePrompt(change))} | ${mdCell(change.before ? describeExpectation(change.before) : "—")} | ${mdCell(change.after ? describeExpectation(change.after) : "—")} |`,
    );
  }
  out.push(
    "",
    "`skillcheck test` checks added and changed assertions against the current corpus. Review removed assertions to confirm that coverage was intentionally dropped.",
    "",
  );
}

export type ScenarioReportFormat = "pretty" | "json" | "markdown" | "github" | "junit";

export interface ScenarioRenderOptions {
  /** Direct `expect` / `forbid` coverage of the scanned skill corpus. */
  coverage?: ScenarioCoverage;
  /** Scenarios file used for GitHub annotation locations. */
  source?: string;
}

/** `skillcheck test` — scenario results for terminals, tools, and pull requests. */
export function renderScenarioResults(
  results: readonly ScenarioResult[],
  format: ScenarioReportFormat,
  options: ScenarioRenderOptions = {},
): string {
  if (format === "json") {
    return JSON.stringify(
      {
        // Coverage is additive to the version 2 envelope; its existing summary
        // and scenario fields keep the same types and meaning.
        version: 2,
        summary: {
          total: results.length,
          passed: results.filter((r) => r.status === "pass").length,
          close: results.filter((r) => r.status === "close").length,
          failed: results.filter((r) => r.status === "fail").length,
        },
        coverage: options.coverage ?? null,
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
  if (format === "junit") return renderScenarioJunit(results, options.source);
  if (format === "markdown") return renderScenarioMarkdown(results, options.coverage);
  if (format === "github") return renderScenarioGithub(results, options);

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

  const { close, failed } = scenarioCounts(results);
  const line = scenarioSummary(results);
  out.push(failed ? pc.red(pc.bold(line)) : close ? pc.yellow(line) : pc.green(line));
  if (options.coverage) appendPrettyCoverage(out, options.coverage);
  return out.join("\n");
}

function scenarioCounts(results: readonly ScenarioResult[]) {
  return {
    passed: results.filter((result) => result.status === "pass").length,
    close: results.filter((result) => result.status === "close").length,
    failed: results.filter((result) => result.status === "fail").length,
  };
}

function scenarioSummary(results: readonly ScenarioResult[]): string {
  const { passed, close, failed } = scenarioCounts(results);
  const parts = [`${passed} passed`];
  if (close) parts.push(`${close} too close to call`);
  if (failed) parts.push(`${failed} failed`);
  return `${parts.join(", ")} (${plural(results.length, "scenario")})`;
}

function appendPrettyCoverage(out: string[], coverage: ScenarioCoverage): void {
  out.push("");
  out.push(
    pc.bold(
      `Assertion coverage: ${coverage.asserted.length}/${coverage.total} distinct skill ${coverage.total === 1 ? "name" : "names"} referenced by expect or forbid`,
    ),
  );
  if (coverage.unasserted.length > 0) {
    const shown = coverage.unasserted.slice(0, 12);
    const rest = coverage.unasserted.length - shown.length;
    out.push(pc.dim(`  Not named: ${shown.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}`));
    out.push(pc.dim("  Add expect or forbid scenarios for requests at those skills' boundaries."));
  }
}

function renderScenarioMarkdown(
  results: readonly ScenarioResult[],
  coverage?: ScenarioCoverage,
): string {
  const out = ["## skillcheck — trigger contracts", "", `**${scenarioSummary(results)}**`, ""];
  out.push("| | Request | Assertion | Actual | Diagnosis |");
  out.push("| --- | --- | --- | --- | --- |");
  for (const result of results) {
    const status =
      result.status === "pass" ? "✔ pass" : result.status === "close" ? "⚠ close" : "✖ fail";
    out.push(
      `| ${status} | ${mdCell(result.scenario.prompt)} | ${mdCell(describeExpectation(result.scenario))} | ${mdCell(result.actual ?? "no skill")} | ${mdCell(result.reason ?? "assertion held")} |`,
    );
  }

  if (coverage) {
    out.push("", "### Assertion coverage", "");
    out.push(
      `**${coverage.asserted.length} of ${coverage.total} distinct skill ${coverage.total === 1 ? "name" : "names"}** referenced by at least one \`expect\` or \`forbid\` assertion.`,
    );
    if (coverage.unasserted.length > 0) {
      const shown = coverage.unasserted.slice(0, 20);
      const rest = coverage.unasserted.length - shown.length;
      out.push("");
      out.push(
        `Not named: ${shown.map((name) => `\`${name}\``).join(", ")}${rest > 0 ? `, and ${rest} more` : ""}.`,
      );
    }
  }
  return out.join("\n");
}

function renderScenarioGithub(
  results: readonly ScenarioResult[],
  options: ScenarioRenderOptions,
): string {
  const location = options.source
    ? ` file=${escapeWorkflowProperty(toPosix(options.source))},line=1`
    : "";
  const out: string[] = [];
  for (const result of results) {
    if (result.status === "pass") continue;
    const kind = result.status === "fail" ? "error" : "warning";
    const detail = result.reason ?? "activation contract is too close to call";
    out.push(
      `::${kind}${location}::${escapeWorkflowData(`[trigger-contract] ${JSON.stringify(result.scenario.prompt)} — ${detail}`)}`,
    );
  }
  out.push(scenarioSummary(results));
  if (options.coverage) {
    out.push(
      `Assertion coverage: ${options.coverage.asserted.length}/${options.coverage.total} distinct skill ${options.coverage.total === 1 ? "name" : "names"} referenced by expect or forbid`,
    );
    if (options.coverage.unasserted.length > 0) {
      const shown = options.coverage.unasserted.slice(0, 20);
      const rest = options.coverage.unasserted.length - shown.length;
      out.push(
        `Not named: ${shown.map(escapeWorkflowData).join(", ")}${rest > 0 ? `, and ${rest} more` : ""}`,
      );
    }
  }
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

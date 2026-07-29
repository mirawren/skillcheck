import pc from "picocolors";
import { describeLanguage } from "./languages/index.js";
import type { TriggerReport } from "./match.js";
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
export function renderTrigger(report: TriggerReport, format: "pretty" | "json"): string {
  if (format === "json") {
    return JSON.stringify(
      {
        version: 1,
        prompt: report.prompt,
        verdict: report.verdict,
        margin: Number(report.margin.toFixed(4)),
        coverage: Number(report.coverage.toFixed(4)),
        terms: report.terms,
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
    out.push(
      pc.yellow(
        `  ⚠ coin flip — ${top.name} leads ${second.name} by only ${Math.round(report.margin * 100)}%`,
      ),
    );
  } else if (top) {
    const lead = second ? ` by ${Math.round(report.margin * 100)}%` : " (only candidate)";
    out.push(pc.green(`  ✔ clear — ${top.name} wins${lead}`));
  }

  // A thin result in a multilingual repo has two very different causes, and the
  // ranking alone cannot tell them apart: the wording may be weak, or the skill
  // that would have answered may simply be described in another language, where
  // no term could ever match. Saying which skills were never in the running
  // turns "no skill covers this" into a question the reader can act on.
  if (report.verdict === "none" && report.outOfLanguage.length > 0) {
    const total = report.outOfLanguage.reduce((sum, entry) => sum + entry.count, 0);
    const breakdown = report.outOfLanguage.map((e) => `${e.label} ${e.count}`).join(", ");
    const plural = total === 1 ? "" : "s";
    out.push(
      pc.dim(
        wrap(
          `${total} skill${plural} here ${total === 1 ? "is" : "are"} described in another language, ` +
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

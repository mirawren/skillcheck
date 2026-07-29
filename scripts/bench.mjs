#!/usr/bin/env node
/**
 * Benchmark the checker on a synthetic corpus.
 *
 * skillcheck's pitch includes "runs on every PR" and "we linted N public
 * skills", so the cost of a run is a claim like any other and gets measured
 * rather than asserted. The cross-skill checks are the interesting part: they
 * compare skills against each other, which is where a naive implementation goes
 * quadratic.
 *
 * Usage: npm run bench [-- 200 1000 5000]
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCheck } from "../dist/index.js";

const dense = process.argv.includes("--dense");
const SIZES = process.argv.slice(2).map(Number).filter(Boolean);
const sizes = SIZES.length ? SIZES : [100, 500, 2000];

const TOPICS = [
  "pdf", "spreadsheet", "invoice", "changelog", "migration", "dashboard",
  "screenshot", "webhook", "deployment", "benchmark", "translation", "podcast",
  "newsletter", "roadmap", "incident", "contract", "resume", "syllabus",
];
const VERBS = ["generates", "extracts", "converts", "summarizes", "validates", "publishes"];
const DOMAINS = [
  "billing", "telemetry", "onboarding", "compliance", "logistics", "marketing",
  "payroll", "inventory", "recruiting", "support", "research", "security",
];
const NOUNS = [
  "ledger", "snapshot", "digest", "manifest", "rubric", "transcript",
  "playbook", "scorecard", "backlog", "runbook", "changeset", "briefing",
];

/**
 * Realistic corpus: each skill gets its own domain/noun pair so descriptions
 * overlap the way a real repo's do. `--dense` instead makes every description
 * near-identical — the worst case for the cross-skill checks, and the reason
 * they report one finding per skill rather than one per pair.
 */
function corpus(root, count, dense) {
  for (let i = 0; i < count; i++) {
    const topic = TOPICS[i % TOPICS.length];
    const verb = VERBS[i % VERBS.length];
    const domain = DOMAINS[i % DOMAINS.length];
    const noun = NOUNS[(i * 7) % NOUNS.length];
    const name = `${topic}-${verb}-${i}`;
    const description = dense
      ? `${verb} ${topic} files into a reviewed artifact. Use when the user asks to ${verb.replace(/s$/, "")} a ${topic}.`
      : `${verb} a ${domain} ${noun} from ${topic} sources, number ${i}. Use when the user asks to ${verb.replace(/s$/, "")} a ${domain} ${noun} or inspect ${topic} ${noun}s.`;
    const dir = join(root, "skills", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "SKILL.md"),
      `---
name: ${name}
description: ${description}
---

# ${name}

1. Read the source ${topic}.
2. Apply the ${domain} template.
3. Return the ${noun}.
`,
    );
  }
}

console.log(`corpus: ${dense ? "dense (worst case — every description alike)" : "realistic"}`);
console.log("skills   duration   findings   throughput");
console.log("──────────────────────────────────────────");

for (const size of sizes) {
  const root = mkdtempSync(join(tmpdir(), "skillcheck-bench-"));
  try {
    corpus(root, size, dense);
    // One warm pass so we time the checker, not the page cache.
    runCheck([root]);
    const start = process.hrtime.bigint();
    const result = runCheck([root]);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(
      `${String(size).padEnd(8)} ${`${ms.toFixed(0)} ms`.padEnd(10)} ${String(result.findings.length).padEnd(10)} ${Math.round(size / (ms / 1000)).toLocaleString()} skills/s`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

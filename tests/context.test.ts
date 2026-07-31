import { realpathSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli";
import { computeBudget } from "../src/budget";
import { collectDocs, evaluate } from "../src/index";
import { captureIo, cleanupTmpRepos, skillMd, tmpRepo } from "./helpers";

afterEach(cleanupTmpRepos);

/** Check a repo and return its findings, for the rule assertions below. */
function check(files: Record<string, string>) {
  const root = tmpRepo(files);
  const docs = collectDocs([root]);
  return { root, docs, result: evaluate(docs.skills, docs.manifests, {}, docs.contexts) };
}

const SKILL = skillMd(
  "pdf-report",
  "Turns markdown into a printable PDF. Use when the user asks to export markdown as a PDF.",
);

describe("context files are discovered", () => {
  it("reads AGENTS.md and CLAUDE.md at a scanned root", () => {
    const { result } = check({
      "AGENTS.md": "# Notes\n\nBuild with npm run build.\n",
      "CLAUDE.md": "# More notes\n\nNever edit dist/.\n",
    });
    expect(result.summary.contexts).toBe(2);
    expect(result.files.contexts).toHaveLength(2);
  });

  it("marks a nested one as not always loaded", () => {
    const { root, docs } = check({
      "AGENTS.md": "# Root\n",
      "packages/api/AGENTS.md": "# Nested\n",
    });
    const resolvedRoot = realpathSync.native(root);
    expect(docs.contexts.find((c) => c.file === join(resolvedRoot, "AGENTS.md"))?.root).toBe(true);
    expect(docs.contexts.find((c) => c.file === join(resolvedRoot, "packages/api/AGENTS.md"))?.root).toBe(false);
  });

  it("never enters node_modules — a dependency's AGENTS.md is not yours", () => {
    const { result } = check({
      "AGENTS.md": "# Root\n",
      "node_modules/dep/AGENTS.md": "# Somebody else's\n",
    });
    expect(result.summary.contexts).toBe(1);
  });

  it("honors ignore globs", () => {
    const root = tmpRepo({ "AGENTS.md": "# Root\n", "vendored/CLAUDE.md": "# Theirs\n" });
    const docs = collectDocs([root], { ignore: ["**/vendored/**"] });
    expect(docs.contexts).toHaveLength(1);
  });

  it("scans a repo that has context files but no skills at all", () => {
    const root = tmpRepo({ "AGENTS.md": "# Notes\n\nBuild with npm run build.\n" });
    const cap = captureIo();
    expect(runCli([root], cap.io)).toBe(0);
    expect(cap.out()).toContain("1 context file");
    expect(cap.out()).not.toContain("0 skills");
  });

  it("still refuses a scan that found nothing", () => {
    const root = tmpRepo({ "README.md": "# nothing here\n" });
    const cap = captureIo();
    expect(runCli([root], cap.io)).toBe(2);
    expect(cap.err()).toContain("AGENTS.md or CLAUDE.md");
  });
});

describe("broken-references over context files", () => {
  it("reports a markdown link to a file that does not exist", () => {
    const { result } = check({ "AGENTS.md": "See [the design](docs/design.md).\n" });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].ruleId).toBe("broken-references");
    expect(result.findings[0].message).toContain("links to `docs/design.md`");
  });

  it("reports a dead @import, and says it is an import", () => {
    const { result } = check({ "CLAUDE.md": "Read @docs/conventions.md first.\n" });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].message).toContain("imports `docs/conventions.md`");
  });

  it("stays quiet when the imported file is there", () => {
    const { result } = check({
      "AGENTS.md": "Read @docs/conventions.md first.\n",
      "docs/conventions.md": "# Conventions\n",
    });
    expect(result.findings).toHaveLength(0);
  });

  it("resolves a nested file's references from its own directory", () => {
    const { result } = check({
      "packages/api/AGENTS.md": "See [the client](client.md).\n",
      "packages/api/client.md": "# Client\n",
    });
    expect(result.findings).toHaveLength(0);
  });

  /**
   * The whole `@` family of false positives, in one test. This rule reports at
   * error severity, so each of these being quiet is what makes it shippable.
   */
  it.each([
    ["an npm scope", "Install @types/node before building.\n"],
    ["an email address", "Ask ops@example.com about deploys.\n"],
    ["a bare handle", "Ping @octocat for review.\n"],
    ["a home-relative path", "Your own notes live in @~/notes/agents.md.\n"],
    ["a URL that contains an @", "See https://example.com/@team/guide.md for details.\n"],
    ["a fenced example", "```md\nRead @docs/missing.md first.\n```\n"],
    ["an inline code span", "The `@docs/missing.md` syntax imports a file.\n"],
  ])("does not report %s", (_label, body) => {
    const { result } = check({ "AGENTS.md": body });
    expect(result.findings).toHaveLength(0);
  });

  it("reports a path once per line, however many times it appears", () => {
    const { result } = check({
      "AGENTS.md": "Read [it](docs/gone.md) — really, [read it](docs/gone.md).\n",
    });
    expect(result.findings).toHaveLength(1);
  });
});

describe("no-placeholders over context files", () => {
  it("names the file it found the marker in", () => {
    const { result } = check({ "CLAUDE.md": "# Notes\n\nTODO: write the deploy steps\n" });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe("warning");
    expect(result.findings[0].message).toContain("CLAUDE.md contains a TODO/FIXME marker");
  });

  it("leaves a marker inside a fenced block alone", () => {
    const { result } = check({ "AGENTS.md": "# Notes\n\n```\nTODO: an example\n```\n" });
    expect(result.findings).toHaveLength(0);
  });
});

describe("context-size", () => {
  const long = (lines: number) =>
    `# Notes\n${Array.from({ length: lines }, () => "Prefer explicit names over abbreviations.").join("\n")}\n`;

  it("warns once the file passes the line budget", () => {
    const { result } = check({ "AGENTS.md": long(300) });
    const sized = result.findings.filter((f) => f.ruleId === "context-size");
    expect(sized.length).toBeGreaterThan(0);
    expect(sized[0].severity).toBe("warning");
    expect(sized[0].message).toContain("AGENTS.md is");
  });

  it("says a root file is paid in every session, and a nested one is not", () => {
    const { result } = check({
      "AGENTS.md": long(300),
      "packages/api/AGENTS.md": long(300),
    });
    const details = result.findings.filter((f) => f.ruleId === "context-size").map((f) => f.detail);
    expect(details.some((d) => d?.includes("in every session"))).toBe(true);
    expect(details.some((d) => d?.includes("works in this directory"))).toBe(true);
  });

  it("stays quiet on a short file", () => {
    const { result } = check({ "AGENTS.md": "# Notes\n\nBuild with npm run build.\n" });
    expect(result.findings).toHaveLength(0);
  });

  it("honors a configured budget", () => {
    const root = tmpRepo({ "AGENTS.md": "# Notes\n\nBuild with npm run build.\n" });
    const docs = collectDocs([root]);
    const result = evaluate(
      docs.skills,
      docs.manifests,
      { options: { "context-size": { maxLines: 1 } } },
      docs.contexts,
    );
    expect(result.findings.map((f) => f.ruleId)).toContain("context-size");
  });

  it("can be switched off", () => {
    const root = tmpRepo({ "AGENTS.md": long(300) });
    const docs = collectDocs([root]);
    const result = evaluate(docs.skills, docs.manifests, { rules: { "context-size": "off" } }, docs.contexts);
    expect(result.findings).toHaveLength(0);
  });

  /** Switching a rule off has to switch it off everywhere it runs. */
  it("switching broken-references off covers context files too", () => {
    const root = tmpRepo({ "AGENTS.md": "See [gone](docs/gone.md).\n" });
    const docs = collectDocs([root]);
    const result = evaluate(
      docs.skills,
      docs.manifests,
      { rules: { "broken-references": "off" } },
      docs.contexts,
    );
    expect(result.findings).toHaveLength(0);
  });
});

describe("a context file is a scored unit", () => {
  it("a clean one raises the average instead of being ignored", () => {
    const withContext = check({
      "skills/pdf-report/SKILL.md": SKILL,
      "AGENTS.md": "See [gone](docs/gone.md).\n",
    });
    expect(withContext.result.files.contexts).toHaveLength(1);
    // The finding lands on the context file, not on the skill.
    expect(withContext.result.findings.every((f) => f.file.endsWith("AGENTS.md"))).toBe(true);
  });
});

describe("budget", () => {
  it("separates what is always loaded from what a skill adds when it fires", () => {
    const { docs } = check({
      "skills/pdf-report/SKILL.md": SKILL,
      "AGENTS.md": "# Notes\n\nBuild with npm run build.\n",
      "packages/api/AGENTS.md": "# Nested\n",
    });
    const budget = computeBudget(docs.skills, docs.contexts);

    expect(budget.skills).toBe(1);
    expect(budget.always.map((l) => l.label)).toEqual(["1 skill description", expect.stringContaining("AGENTS.md")]);
    expect(budget.alwaysTotal).toBe(budget.always.reduce((sum, l) => sum + l.tokens, 0));
    // A nested context file is not part of the always-on total.
    expect(budget.nested).toHaveLength(1);
    expect(budget.perSkill).toHaveLength(1);
    expect(budget.perSkill[0].description).toBeGreaterThan(0);
    expect(budget.perSkill[0].body).toBeGreaterThan(0);
  });

  it("counts a description separately from the body it does not include", () => {
    const { docs } = check({
      "skills/pdf-report/SKILL.md": skillMd("pdf-report", "Short trigger sentence.", "x".repeat(4000)),
    });
    const [skill] = computeBudget(docs.skills, docs.contexts).perSkill;
    expect(skill.body).toBeGreaterThan(skill.description * 10);
  });

  /** The always-on column is what the report exists for, so it sorts on it. */
  it("puts the dearest always-on description first", () => {
    const { docs } = check({
      "skills/small/SKILL.md": skillMd("small", "Short. Use when asked.", "y".repeat(8000)),
      "skills/big/SKILL.md": skillMd(
        "big",
        `Long trigger sentence repeated for weight. ${"Use when the user asks about reports. ".repeat(6)}`,
        "y",
      ),
    });
    const { perSkill } = computeBudget(docs.skills, docs.contexts);
    expect(perSkill.map((s) => s.name)).toEqual(["big", "small"]);
    expect(perSkill[0].body).toBeLessThan(perSkill[1].body);
  });

  it("prints a total and labels every number an estimate", () => {
    const root = tmpRepo({
      "skills/pdf-report/SKILL.md": SKILL,
      "AGENTS.md": "# Notes\n\nBuild with npm run build.\n",
    });
    const cap = captureIo();
    expect(runCli(["budget", root], cap.io)).toBe(0);
    expect(cap.out()).toContain("Always in context");
    expect(cap.out()).toContain("total");
    expect(cap.out()).toMatch(/~\d/);
  });

  it("emits parseable JSON", () => {
    const root = tmpRepo({ "skills/pdf-report/SKILL.md": SKILL, "AGENTS.md": "# Notes\n" });
    const cap = captureIo();
    expect(runCli(["budget", root, "--format", "json"], cap.io)).toBe(0);
    const parsed = JSON.parse(cap.out());
    expect(parsed.version).toBe(1);
    expect(parsed.alwaysTotal).toBeGreaterThan(0);
    expect(parsed.perSkill[0].file).not.toContain("\\");
  });

  it("rejects a format it cannot render", () => {
    const root = tmpRepo({ "AGENTS.md": "# Notes\n" });
    const cap = captureIo();
    expect(runCli(["budget", root, "--format", "sarif"], cap.io)).toBe(2);
    expect(cap.err()).toContain("budget does not support");
  });

  it("exits 2 when there is nothing to weigh", () => {
    const root = tmpRepo({ "README.md": "# nothing\n" });
    const cap = captureIo();
    expect(runCli(["budget", root], cap.io)).toBe(2);
  });

  /** A report, never a gate: it has no opinion about how much is too much. */
  it("exits 0 however large the repo is", () => {
    const root = tmpRepo({ "AGENTS.md": `# Notes\n${"long line of standing instructions\n".repeat(2000)}` });
    const cap = captureIo();
    expect(runCli(["budget", root], cap.io)).toBe(0);
  });
});

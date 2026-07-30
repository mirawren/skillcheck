import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli";
import { buildProbes, compareCorpora, driftFailed, skillChanges } from "../src/drift";
import { parseSkillText } from "../src/parse";
import { renderDrift } from "../src/report";
import { readSkillsAtRef, RevisionError } from "../src/revision";
import type { Scenario } from "../src/scenarios";
import { captureIo, cleanupTmpRepos, skillMd, tmpRepo } from "./helpers";

afterAll(cleanupTmpRepos);

const originalCwd = process.cwd();
afterEach(() => process.chdir(originalCwd));

function skill(name: string, description: string): ReturnType<typeof parseSkillText> {
  return parseSkillText(`/r/skills/${name}/SKILL.md`, skillMd(name, description));
}

function scenario(
  prompt: string,
  fields: Partial<Omit<Scenario, "prompt">> = {},
): Scenario {
  return { prompt, expect: [], forbid: [], expectNone: false, ...fields };
}

const NARROW = skill(
  "changelog-writer",
  "Writes a changelog from git history. Use when the user asks for a changelog or release notes.",
);
const BROAD_BEFORE = skill(
  "release-manager",
  "Bumps the version and tags it. Use when the user asks to cut a release.",
);
const BROAD_AFTER = skill(
  "release-manager",
  "Writes release notes from the git history, bumps the version, tags the release and publishes the package. Use when the user asks to cut a release or write release notes.",
);

describe("comparing two revisions of a corpus", () => {
  it("fails when a scenario contract that passed at the base stops passing", () => {
    const report = compareCorpora({
      ref: "main",
      before: [NARROW, BROAD_BEFORE],
      after: [NARROW, BROAD_AFTER],
      scenarios: [
        scenario("write release notes from the git log", { expect: ["changelog-writer"] }),
      ],
    });
    const flip = report.drifts.find((d) => d.probe.source === "scenario");
    expect(flip?.kind).toBe("regressed");
    expect(flip?.before).toBe("changelog-writer");
    expect(flip?.after).toBe("release-manager");
    expect(driftFailed(report)).toBe(true);
    expect(stripVTControlCharacters(renderDrift(report, "pretty"))).toContain(
      "1 scenario regressed",
    );
    expect(stripVTControlCharacters(renderDrift(report, "pretty"))).not.toContain(
      "1 request changed hands unexpectedly",
    );
  });

  it("does not fail when a description change repairs a scenario contract", () => {
    const report = compareCorpora({
      ref: "main",
      before: [NARROW, BROAD_AFTER],
      after: [NARROW, BROAD_BEFORE],
      scenarios: [
        scenario("write release notes from the git log", { expect: ["changelog-writer"] }),
      ],
    });
    const repair = report.drifts.find((d) => d.probe.source === "scenario");
    expect(repair?.kind).toBe("repaired");
    expect(repair?.before).toBe("release-manager");
    expect(repair?.after).toBe("changelog-writer");
    expect(driftFailed(report)).toBe(false);
  });

  it("allows a request to move between winners the scenario accepts", () => {
    const report = compareCorpora({
      ref: "main",
      before: [NARROW, BROAD_BEFORE],
      after: [NARROW, BROAD_AFTER],
      scenarios: [
        scenario("write release notes from the git log", {
          expect: ["changelog-writer", "release-manager"],
        }),
      ],
    });
    const movement = report.drifts.find((d) => d.probe.source === "scenario");
    expect(movement?.kind).toBe("allowed");
    expect(driftFailed(report)).toBe(false);
  });

  it("evaluates every contract when several scenarios use the same prompt", () => {
    const report = compareCorpora({
      ref: "main",
      before: [NARROW, BROAD_BEFORE],
      after: [NARROW, BROAD_AFTER],
      scenarios: [
        scenario("write release notes from the git log", {
          expect: ["changelog-writer"],
        }),
        scenario("write release notes from the git log", {
          expect: ["changelog-writer", "release-manager"],
        }),
      ],
    });

    expect(report.probes.scenarios).toBe(2);
    expect(report.drifts.filter((drift) => drift.probe.source === "scenario").map((d) => d.kind))
      .toEqual(["regressed", "allowed"]);
    expect(driftFailed(report)).toBe(true);
  });

  it("fails when an expect-none contract starts reaching a skill", () => {
    const added = skill(
      "webhooks",
      "Configures Stripe webhook endpoints. Use when the user asks to debug a Stripe webhook.",
    );
    const report = compareCorpora({
      ref: "main",
      before: [NARROW],
      after: [NARROW, added],
      scenarios: [scenario("debug a Stripe webhook", { expectNone: true })],
    });
    expect(report.drifts.find((d) => d.probe.source === "scenario")?.kind).toBe("regressed");
    expect(driftFailed(report)).toBe(true);
  });

  it("fails when a forbidden skill takes a scenario", () => {
    const report = compareCorpora({
      ref: "main",
      before: [NARROW, BROAD_BEFORE],
      after: [NARROW, BROAD_AFTER],
      scenarios: [
        scenario("write release notes from the git log", { forbid: ["release-manager"] }),
      ],
    });
    const regression = report.drifts.find((d) => d.probe.source === "scenario");
    expect(regression?.kind).toBe("regressed");
    expect(regression?.detail).toContain("must not take this request");
    expect(driftFailed(report)).toBe(true);
  });

  it("reports a lead that collapsed without the winner changing", () => {
    const report = compareCorpora({
      ref: "main",
      before: [NARROW, BROAD_BEFORE],
      after: [NARROW, BROAD_AFTER],
    });
    const narrowed = report.drifts.find((d) => d.kind === "narrowed");
    expect(narrowed).toBeDefined();
    expect(narrowed!.marginAfter).toBeLessThan(narrowed!.marginBefore);
    // A narrowing lead is information, not a broken build.
    expect(driftFailed(report)).toBe(false);
  });

  it("reports a request nothing used to match, instead of falling through to the clean line", () => {
    // `gained` was computed and never read by the summary, so a report whose
    // only drift was a newly claimed request printed "no request changes hands".
    const added = skill(
      "webhooks",
      "Configures Stripe webhook endpoints and verifies signatures. Use when the user asks to debug a Stripe webhook.",
    );
    const report = compareCorpora({
      ref: "main",
      before: [NARROW],
      after: [NARROW, added],
      scenarios: [scenario("debug a stripe webhook signature")],
    });
    expect(report.drifts.map((d) => d.kind)).toContain("gained");
    expect(driftFailed(report)).toBe(false);
    expect(renderDrift(report, "pretty")).not.toContain("no request changes hands");
  });

  it("says nothing at all when no decisive text changed", () => {
    const report = compareCorpora({
      ref: "main",
      before: [NARROW, BROAD_BEFORE],
      after: [NARROW, BROAD_BEFORE],
      scenarios: [scenario("write release notes from the git log")],
    });
    expect(report.drifts).toEqual([]);
    expect(report.changes).toEqual([]);
    expect(driftFailed(report)).toBe(false);
    // …but it still says how much it checked, so a clean run reads as a result.
    expect(report.probes.total).toBeGreaterThan(0);
  });

  it("does not fail a build for adding a skill", () => {
    // A tool that punishes you for adding a skill is a tool you uninstall.
    const added = skill(
      "notes-writer",
      "Writes release notes from the commit log. Use when the user asks for release notes.",
    );
    const report = compareCorpora({
      ref: "main",
      before: [NARROW, BROAD_BEFORE],
      after: [NARROW, BROAD_BEFORE, added],
    });
    expect(report.changes.map((c) => c.kind)).toEqual(["added"]);
    expect(driftFailed(report)).toBe(false);
  });

  it("calls movement in a skill the author edited intended, not collateral", () => {
    const before = [
      skill("a-tool", "Formats YAML files. Use when the user asks to tidy a YAML file."),
      skill("b-tool", "Validates JSON schemas. Use when the user asks to check a schema."),
    ];
    const after = [
      skill(
        "a-tool",
        "Validates JSON schemas and formats YAML files. Use when the user asks to check a schema or tidy a YAML file.",
      ),
      before[1],
    ];
    const report = compareCorpora({ ref: "main", before, after });
    const kinds = new Set(report.drifts.map((d) => d.kind));
    expect(kinds.has("collateral")).toBe(false);
  });

  it("does not call a pure rename a change of hands", () => {
    // A skill's identity across two revisions is its file, not its `name`.
    // Comparing names made renaming `changelog-writer` to `changelog` — same
    // file, same description — report every request it won as collateral drift
    // and fail the build, about one unchanged skill under a new label.
    const renamed = parseSkillText(
      NARROW.file,
      skillMd(
        "changelog",
        "Writes a changelog from git history. Use when the user asks for a changelog or release notes.",
      ),
    );
    const report = compareCorpora({
      ref: "main",
      before: [NARROW, BROAD_BEFORE],
      after: [renamed, BROAD_BEFORE],
      scenarios: [scenario("write release notes from the git log")],
    });
    expect(report.changes.map((c) => c.kind)).toEqual(["renamed"]);
    expect(report.drifts).toEqual([]);
    expect(driftFailed(report)).toBe(false);
  });

  it("ranks both wordings of an edited description, so old phrasing is checked too", () => {
    const probes = buildProbes([NARROW, BROAD_BEFORE], [NARROW, BROAD_AFTER]);
    const owned = probes.filter((p) => p.owner === "release-manager");
    expect(owned).toHaveLength(2);
    expect(owned.every((p) => p.ownerTouched)).toBe(true);
  });

  it("builds no description probe for a skill that only exists on one side", () => {
    const added = skill("newcomer", "Does a new thing. Use when the user asks for the new thing.");
    const probes = buildProbes([NARROW], [NARROW, added]);
    expect(probes.some((p) => p.owner === "newcomer")).toBe(false);
  });

  it("names the decisive fields that changed, and ignores a rewritten body", () => {
    const sameDecisiveText = parseSkillText(
      NARROW.file,
      skillMd(
        "changelog-writer",
        "Writes a changelog from git history. Use when the user asks for a changelog or release notes.",
        "A completely rewritten body that cannot move any ranking.",
      ),
    );
    expect(skillChanges([NARROW], [sameDecisiveText])).toEqual([]);
    expect(skillChanges([NARROW, BROAD_BEFORE], [NARROW, BROAD_AFTER])).toEqual([
      {
        file: BROAD_AFTER.file,
        name: "release-manager",
        kind: "retriggered",
        fields: ["description"],
      },
    ]);
  });
});

describe("comparing findings between revisions", () => {
  const clean = skill("solo", "Does one thing. Use when the user asks for that one thing.");
  const twin = skill("twin", "Does one thing. Use when the user asks for that one thing.");

  it("reports only what this change introduced, not the pre-existing backlog", () => {
    const stale = { ruleId: "body-size", file: clean.file, message: "too big", severity: "warning" as const };
    const report = compareCorpora({
      ref: "main",
      before: [clean],
      after: [clean, twin],
      findingsBefore: [stale],
      findingsAfter: [
        stale,
        { ruleId: "description-similarity", file: twin.file, message: "88% similar", severity: "error" },
      ],
    });
    expect(report.findings).toEqual([
      {
        status: "new",
        ruleId: "description-similarity",
        file: twin.file,
        message: "88% similar",
        severity: "error",
        collateral: false,
      },
    ]);
    // A new *error* is the third thing that fails a build.
    expect(driftFailed(report)).toBe(true);
  });

  it("credits a finding that went away", () => {
    const report = compareCorpora({
      ref: "main",
      before: [clean],
      after: [clean],
      findingsBefore: [
        { ruleId: "when-to-use", file: clean.file, message: "no trigger", severity: "error" },
      ],
      findingsAfter: [],
    });
    expect(report.findings.map((f) => f.status)).toEqual(["fixed"]);
    expect(driftFailed(report)).toBe(false);
  });

  it("does not report a reworded finding as one fixed and one introduced", () => {
    // description-similarity names the sibling it collided with, so adding a
    // third near-duplicate rewords a finding that was already there.
    const report = compareCorpora({
      ref: "main",
      before: [clean],
      after: [clean],
      findingsBefore: [
        { ruleId: "description-similarity", file: clean.file, message: "88% similar to a", severity: "error" },
      ],
      findingsAfter: [
        { ruleId: "description-similarity", file: clean.file, message: "91% similar to b", severity: "error" },
      ],
    });
    expect(report.findings).toEqual([]);
  });

  it("marks a new finding on an untouched skill as collateral", () => {
    const report = compareCorpora({
      ref: "main",
      before: [clean],
      after: [clean, twin],
      findingsAfter: [
        { ruleId: "description-similarity", file: clean.file, message: "88% similar", severity: "error" },
      ],
    });
    expect(report.findings[0].collateral).toBe(true);
  });
});

// ── reading a revision out of git ────────────────────────────────────────────

function gitRepo(files: Record<string, string>): string {
  const root = tmpRepo(files);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { stdio: "pipe", encoding: "utf8" });
  git("init", "-q", ".");
  git("add", "-A");
  git("-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "init");
  return root;
}

function write(root: string, rel: string, content: string): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe("reading skills at a git revision", () => {
  it("parses the committed text, not what is on disk now", () => {
    const root = gitRepo({
      "skills/one/SKILL.md": skillMd("one", "The original. Use when the user asks for the original."),
    });
    write(root, "skills/one/SKILL.md", skillMd("one", "Rewritten. Use when the user asks for the rewrite."));

    process.chdir(root);
    const committed = readSkillsAtRef("HEAD", ["."]);
    expect(committed).toHaveLength(1);
    expect(committed[0].description).toContain("The original");
  });

  it("survives a description written outside ASCII", () => {
    // cat-file reports sizes in bytes, so the response has to be walked as a
    // buffer — decoding first desynchronizes on the first multi-byte character,
    // which in this project's subject matter is every non-English skill.
    const root = gitRepo({
      "skills/gijiroku/SKILL.md": skillMd(
        "gijiroku",
        "会議の音声から議事録を作成します。ユーザーが議事録の作成を依頼したときに使用します。",
        "音声を文字にして、要点をまとめる。",
      ),
    });
    process.chdir(root);
    const [doc] = readSkillsAtRef("HEAD", ["."]);
    expect(doc.description).toContain("議事録");
  });

  it("discovers the same skills git-side as the filesystem walk does", () => {
    // The two readers disagreed: git's listing matched any path merely *ending*
    // in SKILL.md and entered every directory, while the walk requires the exact
    // basename and skips vendor/, dist/, node_modules/ and friends. On a
    // completely clean tree, a repo with a committed vendor copy and a
    // docs/EXAMPLE-SKILL.md reported "3 skills there · 1 here · 2 removed" and
    // five findings "fixed" — a diff against no change at all. The phantoms
    // landed only on the historical side, so they also shifted its idf.
    const root = gitRepo({
      "skills/pdf-export/SKILL.md": skillMd(
        "pdf-export",
        "Renders markdown to a paginated PDF. Use when the user asks to export a document as a PDF.",
      ),
      "vendor/upstream/pdf-export/SKILL.md": skillMd(
        "pdf-export",
        "Renders markdown to a paginated PDF with a cover page. Use when the user asks to export a document as a PDF.",
      ),
      "docs/EXAMPLE-SKILL.md": skillMd("example", "A template you copy. Use when starting a new skill."),
      "node_modules/pkg/skills/dep/SKILL.md": skillMd("dep", "A dependency's skill. Use when asked."),
    });
    process.chdir(root);

    expect(readSkillsAtRef("HEAD", ["."]).map((d) => d.name)).toEqual(["pdf-export"]);

    // And the whole point: an untouched tree produces an empty report.
    const cap = captureIo();
    expect(runCli(["diff"], cap.io)).toBe(0);
    const out = stripVTControlCharacters(cap.out());
    expect(out).toContain("no request changes hands");
    expect(out).not.toContain("removed");
  });

  it("explains an unknown ref in terms of the shallow clone that usually causes it", () => {
    const root = gitRepo({ "skills/one/SKILL.md": skillMd("one", "A. Use when asked for A.") });
    process.chdir(root);
    expect(() => readSkillsAtRef("no-such-ref", ["."])).toThrow(RevisionError);
    expect(() => readSkillsAtRef("no-such-ref", ["."])).toThrow(/fetch-depth/);
  });
});

describe("the diff command", () => {
  it("fails the build on a scenario regression and names both skills", () => {
    const root = gitRepo({
      "skills/changelog-writer/SKILL.md": skillMd(
        "changelog-writer",
        "Writes a changelog from git history. Use when the user asks for a changelog or release notes.",
      ),
      "skills/release-manager/SKILL.md": skillMd(
        "release-manager",
        "Bumps the version and tags it. Use when the user asks to cut a release.",
      ),
      "skillcheck.scenarios.yaml":
        'version: 1\nscenarios:\n  - prompt: "write release notes from the git log"\n    expect: changelog-writer\n',
    });
    write(
      root,
      "skills/release-manager/SKILL.md",
      skillMd(
        "release-manager",
        "Writes release notes from the git history, bumps the version, tags the release and publishes the package. Use when the user asks to cut a release or write release notes.",
      ),
    );

    process.chdir(root);
    const cap = captureIo();
    expect(runCli(["diff"], cap.io)).toBe(1);
    const out = stripVTControlCharacters(cap.out());
    expect(out).toContain("scenario regressed");
    expect(out).toContain("changelog-writer → release-manager");
    expect(out).toContain("from your scenarios file");
  });

  it("does not fail a PR that adds a skill together with its scenario", () => {
    // The workflow `skillcheck init` teaches. The new prompt has no answer at the
    // base revision, so ranking it there invented one: some incumbent "won" a
    // request that did not exist yet, and the report called that a request
    // changing hands — reddening exactly the pull request the tool asks for.
    const root = gitRepo({
      "skills/pdf-forms/SKILL.md": skillMd(
        "pdf-forms",
        "Fills in PDF form fields from a data file. Use when the user asks to fill a PDF form.",
      ),
      "skillcheck.scenarios.yaml":
        'version: 1\nscenarios:\n  - prompt: "fill in this PDF form from my spreadsheet"\n    expect: pdf-forms\n',
    });
    write(
      root,
      "skills/pdf-signing/SKILL.md",
      skillMd(
        "pdf-signing",
        "Adds a digital signature to a PDF document. Use when the user asks to sign a PDF.",
      ),
    );
    write(
      root,
      "skillcheck.scenarios.yaml",
      'version: 1\nscenarios:\n  - prompt: "fill in this PDF form from my spreadsheet"\n    expect: pdf-forms\n  - prompt: "add a digital signature to this PDF document"\n    expect: pdf-signing\n',
    );

    process.chdir(root);
    const cap = captureIo();
    expect(runCli(["diff"], cap.io)).toBe(0);
    const out = stripVTControlCharacters(cap.out());
    // …and it says which assertion it declined to compare, rather than silently
    // dropping it.
    expect(out).toContain("not compared");
    expect(out).toContain("skillcheck test");
  });

  it("does not compare a scenario whose assertion changed in this PR", () => {
    const root = gitRepo({
      "skills/alpha/SKILL.md": skillMd(
        "alpha",
        "Handles alpha reports. Use when the user asks to write an alpha report.",
      ),
      "skills/beta/SKILL.md": skillMd(
        "beta",
        "Handles beta exports. Use when the user asks to export beta data.",
      ),
      "skillcheck.scenarios.yaml":
        'version: 1\nscenarios:\n  - prompt: "write this report"\n    expect: alpha\n',
    });
    write(
      root,
      "skills/beta/SKILL.md",
      skillMd(
        "beta",
        "Writes reports and exports beta data. Use when the user asks to write a report or export beta data.",
      ),
    );
    write(
      root,
      "skillcheck.scenarios.yaml",
      'version: 1\nscenarios:\n  - prompt: "write this report"\n    expect: beta\n',
    );

    process.chdir(root);
    const cap = captureIo();
    expect(runCli(["diff"], cap.io)).toBe(0);
    const out = stripVTControlCharacters(cap.out());
    expect(out).toContain("assertion changed");
    expect(out).toContain("skillcheck test");
    expect(out).not.toContain("scenario repaired");

    const machine = captureIo();
    expect(runCli(["diff", "--format", "json"], machine.io)).toBe(0);
    expect(() => JSON.parse(machine.out())).not.toThrow();
    expect(machine.err()).toContain("assertion changed");
  });

  it("exits clean, and says what it checked, when nothing moved", () => {
    const root = gitRepo({
      "skills/one/SKILL.md": skillMd("one", "Does A. Use when the user asks for A."),
      "skills/two/SKILL.md": skillMd("two", "Does B. Use when the user asks for B."),
    });
    process.chdir(root);
    const cap = captureIo();
    expect(runCli(["diff"], cap.io)).toBe(0);
    expect(stripVTControlCharacters(cap.out())).toContain("no request changes hands");
  });

  it("emits machine-readable drift for a bot to comment with", () => {
    const root = gitRepo({
      "skills/one/SKILL.md": skillMd("one", "Does A. Use when the user asks for A."),
    });
    write(root, "skills/one/SKILL.md", skillMd("one", "Does B. Use when the user asks for B."));
    process.chdir(root);
    const cap = captureIo();
    runCli(["diff", "HEAD", "--format", "json"], cap.io);
    const parsed = JSON.parse(cap.out());
    expect(parsed.version).toBe(2);
    expect(parsed.ref).toBe("HEAD");
    expect(parsed.changes[0].kind).toBe("retriggered");
    expect(parsed.probes.total).toBeGreaterThan(0);
  });

  it("takes a path instead of a ref without mistaking one for the other", () => {
    const root = gitRepo({
      "skills/one/SKILL.md": skillMd("one", "Does A. Use when the user asks for A."),
    });
    process.chdir(root);
    const cap = captureIo();
    expect(runCli(["diff", "skills", "--format", "json"], cap.io)).toBe(0);
    expect(JSON.parse(cap.out()).ref).toBe("HEAD");
  });

  it("reports a missing revision as a usage error, not a finding", () => {
    const root = gitRepo({
      "skills/one/SKILL.md": skillMd("one", "Does A. Use when the user asks for A."),
    });
    process.chdir(root);
    const cap = captureIo();
    expect(runCli(["diff", "definitely-not-a-ref"], cap.io)).toBe(2);
    expect(cap.err()).toContain("no revision named");
  });
});

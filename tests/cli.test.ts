import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli";
import { captureIo, cleanupTmpRepos, skillMd, tmpRepo } from "./helpers";

afterAll(cleanupTmpRepos);

const originalCwd = process.cwd();
afterEach(() => process.chdir(originalCwd));

const CLEAN = {
  "skills/pdf-report/SKILL.md": skillMd(
    "pdf-report",
    "Generates polished PDF reports from markdown. Use when the user asks to export analysis results as a PDF.",
  ),
};

const BROKEN = {
  "skills/PDF_Tools/SKILL.md":
    "---\nname: PDF_Tools\ndescription: PDF tools.\ndescripton: typo key\n---\n\n# PDF Tools\n\nSee [the template](templates/report.html).\n",
};

describe("informational commands", () => {
  it("prints help and exits clean", () => {
    const cap = captureIo();
    expect(runCli(["--help"], cap.io)).toBe(0);
    expect(cap.out()).toContain("skillcheck why");
    expect(cap.out()).toContain("Exit codes");
  });

  it("prints a version", () => {
    const cap = captureIo();
    expect(runCli(["--version"], cap.io)).toBe(0);
    expect(cap.out().trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("lists every check, marking the fixable ones", () => {
    const cap = captureIo();
    expect(runCli(["rules"], cap.io)).toBe(0);
    expect(cap.out()).toContain("when-to-use");
    expect(cap.out()).toContain("plugin-manifest");
    expect(stripVTControlCharacters(cap.out())).toMatch(/name-format\s+fix/);
  });

  it("lists the recognized languages", () => {
    const cap = captureIo();
    expect(runCli(["languages", "."], cap.io)).toBe(0);
    expect(cap.out()).toContain("Recognized languages");
    // Code and endonym both, because the code is what you write in
    // `x-skillcheck.lang` and the endonym is how a reader finds their own.
    expect(cap.out()).toMatch(/\bja\s+Japanese \(日本語\)/);
    expect(cap.out()).toMatch(/\bar\s+Arabic \(العربية\)/);
  });

  it("explains a rule with its reasoning and examples", () => {
    const cap = captureIo();
    expect(runCli(["explain", "when-to-use"], cap.io)).toBe(0);
    expect(cap.out()).toContain("Why it matters");
    expect(cap.out()).toContain("Trips on");
    expect(cap.out()).toContain("Turn it off");
  });

  it("suggests near matches for an unknown rule", () => {
    const cap = captureIo();
    expect(runCli(["explain", "when-to"], cap.io)).toBe(2);
    expect(cap.err()).toContain("when-to-use");
  });

  it("rejects an unknown option with exit code 2, not 1", () => {
    const cap = captureIo();
    // 1 means "found problems"; usage errors must be distinguishable in CI.
    expect(runCli(["--nope"], cap.io)).toBe(2);
    expect(cap.err()).toContain("unknown option");
  });

  it("rejects a path that does not exist", () => {
    const cap = captureIo();
    expect(runCli(["/definitely/not/here"], cap.io)).toBe(2);
    expect(cap.err()).toContain("path not found");
  });
});

describe("check", () => {
  it("exits 0 on a clean repo", () => {
    const cap = captureIo();
    expect(runCli([tmpRepo(CLEAN)], cap.io)).toBe(0);
    expect(cap.out()).toContain("no problems found");
    expect(cap.out()).toContain("100/100 (A)");
  });

  it("exits 1 when it finds errors", () => {
    const cap = captureIo();
    expect(runCli([tmpRepo(BROKEN)], cap.io)).toBe(1);
    expect(cap.out()).toContain("name-format");
  });

  it("emits machine-readable JSON with a score and findings", () => {
    const cap = captureIo();
    runCli([tmpRepo(BROKEN), "--format", "json"], cap.io);
    const parsed = JSON.parse(cap.out());
    expect(parsed.version).toBe(1);
    expect(parsed.score.grade).toMatch(/^[A-F]$/);
    expect(parsed.findings.length).toBeGreaterThan(0);
    expect(parsed.summary.skills).toBe(1);
  });

  it("emits a shields.io endpoint badge on stdout alone", () => {
    const cap = captureIo();
    runCli([tmpRepo(CLEAN), "--format", "badge"], cap.io);
    const badge = JSON.parse(cap.out());
    expect(badge.schemaVersion).toBe(1);
    expect(badge.label).toBe("skillcheck");
    expect(badge.message).toContain("100");
  });

  it("emits SARIF with per-rule help for the Security tab", () => {
    const cap = captureIo();
    runCli([tmpRepo(BROKEN), "--format", "sarif"], cap.io);
    const sarif = JSON.parse(cap.out());
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0].results.length).toBeGreaterThan(0);
    expect(sarif.runs[0].tool.driver.rules[0].help.markdown).toBeTruthy();
    for (const result of sarif.runs[0].results) {
      expect(result.locations[0].physicalLocation.artifactLocation.uri).not.toContain("\\");
    }
  });

  it("keeps stdout parseable by routing advice to stderr", () => {
    const cap = captureIo();
    runCli([tmpRepo(BROKEN), "--format", "json"], cap.io);
    expect(() => JSON.parse(cap.out())).not.toThrow();
    expect(cap.err()).toContain("--fix");
  });

  it("fails on warnings once --max-warnings is exceeded", () => {
    const root = tmpRepo({
      "skills/thing/SKILL.md": skillMd(
        "thing",
        "Sorts the inbox into folders by sender. Use when the user asks to tidy their inbox.",
        "TODO: write this properly",
      ),
    });
    expect(runCli([root], captureIo().io)).toBe(0);
    expect(runCli([root, "--max-warnings", "0"], captureIo().io)).toBe(1);
  });

  it("shows errors only with --quiet", () => {
    const cap = captureIo();
    runCli([tmpRepo(BROKEN), "--quiet"], cap.io);
    expect(cap.out()).not.toContain("unknown-keys");
    expect(cap.out()).toContain("name-format");
  });
});

describe("--fix", () => {
  it("repairs the file and re-reports the remaining findings", () => {
    const root = tmpRepo(BROKEN);
    const file = join(root, "skills/PDF_Tools/SKILL.md");
    const cap = captureIo();

    runCli([root, "--fix"], cap.io);

    expect(readFileSync(file, "utf8")).toContain("name: pdf-tools");
    expect(cap.out()).toContain("fixed 1 file(s)");
    // The error is gone. What's left is the folder-name mismatch, a warning —
    // renaming someone's directory is not a safe automatic fix.
    expect(cap.out()).not.toContain("is not valid");
    expect(cap.out()).toContain("does not match its folder");
  });

  it("writes nothing in --fix-dry-run", () => {
    const root = tmpRepo(BROKEN);
    const file = join(root, "skills/PDF_Tools/SKILL.md");
    const before = readFileSync(file, "utf8");
    const cap = captureIo();

    runCli([root, "--fix-dry-run"], cap.io);

    expect(readFileSync(file, "utf8")).toBe(before);
    expect(cap.out()).toContain("would change");
  });

  it("says so plainly when there is nothing to fix", () => {
    const cap = captureIo();
    runCli([tmpRepo(CLEAN), "--fix"], cap.io);
    expect(cap.out()).toContain("nothing to fix automatically");
  });
});

describe("baselines", () => {
  it("accepts existing findings, then fails only on new ones", () => {
    const root = tmpRepo(BROKEN);
    const baseline = join(root, "baseline.json");

    expect(runCli([root, "--update-baseline", "--baseline", baseline], captureIo().io)).toBe(0);
    expect(existsSync(baseline)).toBe(true);

    const accepted = captureIo();
    expect(runCli([root, "--baseline", baseline], accepted.io)).toBe(0);
    expect(accepted.out()).toContain("no NEW problems");
    // The score stays honest even though CI is green.
    expect(accepted.out()).not.toContain("100/100");

    writeFileSync(join(root, "skills/PDF_Tools/extra.md"), "unused");
    writeFileSync(
      join(root, "skills/late/SKILL.md".replace("late/", "")),
      skillMd("late", "Does things."),
    );
    const regressed = captureIo();
    expect(runCli([root, "--baseline", baseline], regressed.io)).toBe(1);
  });

  it("--no-baseline ignores a baseline that is sitting right there", () => {
    const root = tmpRepo(BROKEN);
    process.chdir(root);
    runCli([".", "--update-baseline"], captureIo().io);
    expect(runCli(["."], captureIo().io)).toBe(0);
    expect(runCli([".", "--no-baseline"], captureIo().io)).toBe(1);
  });

  it("points out baseline entries that no longer occur", () => {
    const root = tmpRepo(BROKEN);
    const baseline = join(root, "baseline.json");
    runCli([root, "--update-baseline", "--baseline", baseline], captureIo().io);
    runCli([root, "--fix"], captureIo().io);

    const cap = captureIo();
    runCli([root, "--baseline", baseline], cap.io);
    expect(cap.all()).toContain("--update-baseline");
  });
});

describe("why", () => {
  it("ranks the skills a request would reach", () => {
    const cap = captureIo();
    expect(runCli(["why", "export this analysis as a pdf", tmpRepo(CLEAN)], cap.io)).toBe(0);
    expect(cap.out()).toContain("pdf-report");
    expect(cap.out()).toContain("clear");
  });

  it("calls out a coin flip between two similar skills", () => {
    const root = tmpRepo({
      "skills/grill-me/SKILL.md": skillMd(
        "grill-me",
        "Reviews your code changes for bugs, style issues and missed edge cases before you commit them.",
      ),
      "skills/review-me/SKILL.md": skillMd(
        "review-me",
        "Reviews your code changes for bugs, style problems and missed edge cases before you commit them.",
      ),
    });
    const cap = captureIo();
    runCli(["why", "review my code changes before I commit", root], cap.io);
    expect(cap.out()).toContain("coin flip");
  });

  it("states plainly when nothing matches", () => {
    const cap = captureIo();
    runCli(["why", "what time is it in Tokyo", tmpRepo(CLEAN)], cap.io);
    expect(cap.out()).toContain("no skill");
  });

  it("emits JSON on request", () => {
    const cap = captureIo();
    runCli(["why", "export a pdf", tmpRepo(CLEAN), "--format", "json"], cap.io);
    const parsed = JSON.parse(cap.out());
    expect(parsed.verdict).toMatch(/clear|close|none/);
    expect(parsed.terms).toContain("pdf");
  });

  it("needs a request", () => {
    const cap = captureIo();
    expect(runCli(["why"], cap.io)).toBe(2);
    expect(cap.err()).toContain("needs a request");
  });
});

describe("languages, in a repo that spans several", () => {
  // Two skills that answer the same kind of request, described in different
  // languages — the shape that makes any of this matter.
  const MULTILINGUAL = {
    "skills/pdf-en/SKILL.md": skillMd(
      "pdf-en",
      "Converts Markdown documents into printable PDF reports. Use when the user asks to produce a PDF.",
    ),
    "skills/chart-zh/SKILL.md": skillMd(
      "chart-zh",
      "将电子表格数据转换为图表。当用户请求生成数据可视化图表时使用。",
      "把数据变成图表，并保存为图片文件。",
    ),
  };

  it("groups the skills by the language each is described in", () => {
    const cap = captureIo();
    expect(runCli(["languages", tmpRepo(MULTILINGUAL)], cap.io)).toBe(0);
    expect(cap.out()).toContain("Your skills");
    expect(cap.out()).toContain("English");
    expect(cap.out()).toContain("Chinese (中文)");
  });

  it("reports the split as JSON for scripting", () => {
    const cap = captureIo();
    runCli(["languages", tmpRepo(MULTILINGUAL), "--format", "json"], cap.io);
    const parsed = JSON.parse(cap.out());
    expect(parsed.skills).toBe(2);
    expect(parsed.languages.map((l: { code: string }) => l.code).sort()).toEqual(["en", "zh"]);
    expect(parsed.recognized.length).toBeGreaterThan(10);
  });

  it("still lists the registry when there are no skills to group", () => {
    const cap = captureIo();
    expect(runCli(["languages", tmpRepo({ "README.md": "nothing here" })], cap.io)).toBe(0);
    expect(cap.out()).toContain("no SKILL.md found");
    expect(cap.out()).toContain("Recognized languages");
  });

  it("tells `why` that the miss was the language, not the wording", () => {
    // The English request cannot reach the Chinese skill: no shared term
    // exists to rank on. Without this line the output reads "no skill covers
    // this", which sends the author off to reword a description that is fine.
    const cap = captureIo();
    runCli(["why", "turn a spreadsheet into a chart", tmpRepo(MULTILINGUAL)], cap.io);
    expect(cap.out()).toContain("described in another language");
    expect(cap.out()).toContain("Chinese (中文)");
  });

  it("carries the same fact into the JSON output", () => {
    const cap = captureIo();
    runCli(
      ["why", "turn a spreadsheet into a chart", tmpRepo(MULTILINGUAL), "--format", "json"],
      cap.io,
    );
    const parsed = JSON.parse(cap.out());
    expect(parsed.language).toBe("en");
    expect(parsed.outOfLanguage).toEqual([{ code: "zh", label: "Chinese (中文)", count: 1 }]);
  });
});

describe("test (trigger scenarios)", () => {
  const scenarios = (body: string) => {
    const root = tmpRepo(CLEAN);
    const file = join(root, "scenarios.yaml");
    writeFileSync(file, body);
    return { root, file };
  };

  it("passes when each request reaches its skill", () => {
    const { root, file } = scenarios(
      'scenarios:\n  - prompt: "export this analysis as a pdf"\n    expect: pdf-report\n  - prompt: "what time is it in Tokyo"\n    expect: none\n',
    );
    const cap = captureIo();
    expect(runCli(["test", root, "--scenarios", file], cap.io)).toBe(0);
    expect(cap.out()).toContain("2 passed");
    expect(stripVTControlCharacters(cap.out())).toContain(
      "Assertion coverage: 1/1 skill named in expect or forbid",
    );
  });

  it("fails, and says what actually won", () => {
    const { root, file } = scenarios(
      'scenarios:\n  - prompt: "export this analysis as a pdf"\n    expect: none\n',
    );
    const cap = captureIo();
    expect(runCli(["test", root, "--scenarios", file], cap.io)).toBe(1);
    expect(cap.out()).toContain("pdf-report");
  });

  it("includes assertion coverage in JSON", () => {
    const { root, file } = scenarios(
      'scenarios:\n  - prompt: "export this analysis as a pdf"\n    expect: pdf-report\n',
    );
    const cap = captureIo();

    expect(runCli(["test", root, "--scenarios", file, "--format", "json"], cap.io)).toBe(0);
    const parsed = JSON.parse(cap.out());
    expect(parsed.version).toBe(2);
    expect(parsed.coverage).toEqual({
      total: 1,
      asserted: ["pdf-report"],
      unasserted: [],
    });
  });

  it("annotates failures and writes a trigger-contract job summary", () => {
    const { root, file } = scenarios(
      'scenarios:\n  - prompt: "export this analysis as a pdf"\n    expect: none\n',
    );
    const summaryFile = join(root, "summary.md");
    writeFileSync(summaryFile, "");
    const cap = captureIo({ GITHUB_STEP_SUMMARY: summaryFile });

    expect(
      runCli(
        ["test", root, "--scenarios", file, "--format", "github", "--summary"],
        cap.io,
      ),
    ).toBe(1);
    expect(cap.out()).toMatch(/::error file=.*scenarios\.yaml,line=1::\[trigger-contract\]/);
    expect(cap.out()).toContain("1 failed");

    const summary = readFileSync(summaryFile, "utf8");
    expect(summary).toContain("## skillcheck — trigger contracts");
    expect(summary).toContain("expected no skill to match");
    expect(summary).toContain("0 of 1 skill");
  });

  it("emits a warning annotation when a contract is too close to call", () => {
    const root = tmpRepo({
      "skills/grill-me/SKILL.md": skillMd(
        "grill-me",
        "Reviews your code changes for bugs, style issues and missed edge cases before you commit them.",
      ),
      "skills/review-me/SKILL.md": skillMd(
        "review-me",
        "Reviews your code changes for bugs, style problems and missed edge cases before you commit them.",
      ),
    });
    const file = join(root, "scenarios.yaml");
    writeFileSync(
      file,
      'scenarios:\n  - prompt: "review my code changes before I commit"\n    expect: review-me\n',
    );
    const cap = captureIo();

    expect(runCli(["test", root, "--scenarios", file, "--format", "github"], cap.io)).toBe(0);
    expect(cap.out()).toMatch(/::warning file=.*::\[trigger-contract\]/);
  });

  it("excludes config-ignored skills from the coverage denominator", () => {
    const root = tmpRepo({
      ...CLEAN,
      "skills/invoice-parser/SKILL.md": skillMd(
        "invoice-parser",
        "Parses invoices into line items. Use when the user asks to read an invoice.",
      ),
    });
    const file = join(root, "scenarios.yaml");
    const config = join(root, "skillcheck.config.json");
    writeFileSync(
      file,
      'scenarios:\n  - prompt: "export this analysis as a pdf"\n    expect: pdf-report\n',
    );
    writeFileSync(config, '{"ignore":["**/invoice-parser/**"]}\n');
    const cap = captureIo();

    expect(runCli(["test", root, "--scenarios", file, "--config", config], cap.io)).toBe(0);
    expect(stripVTControlCharacters(cap.out())).toContain("Assertion coverage: 1/1 skill");
    expect(cap.out()).not.toContain("invoice-parser");
  });

  it("explains itself when there is no scenarios file", () => {
    const cap = captureIo();
    process.chdir(tmpRepo(CLEAN));
    expect(runCli(["test"], cap.io)).toBe(2);
    expect(cap.err()).toContain("skillcheck init");
  });

  it("reports a malformed scenarios file as a usage error", () => {
    const { root, file } = scenarios("scenarios:\n  - expect: pdf-report\n");
    const cap = captureIo();
    expect(runCli(["test", root, "--scenarios", file], cap.io)).toBe(2);
    expect(cap.err()).toContain("prompt");
  });
});

describe("init", () => {
  it("scaffolds CI and trigger tests that pass on the first run", () => {
    const root = tmpRepo(CLEAN);
    const cap = captureIo();

    expect(runCli(["init", root], cap.io)).toBe(0);
    expect(existsSync(join(root, ".github/workflows/skillcheck.yml"))).toBe(true);
    expect(existsSync(join(root, "skillcheck.scenarios.yaml"))).toBe(true);
    const workflow = readFileSync(join(root, ".github/workflows/skillcheck.yml"), "utf8");
    expect(workflow).toContain("uses: mirawren/skillcheck@v1");
    expect(workflow).not.toContain("skillcheck@latest");

    process.chdir(root);
    expect(runCli(["test"], captureIo().io)).toBe(0);
  });

  it("never overwrites without --force", () => {
    const root = tmpRepo(CLEAN);
    runCli(["init", root], captureIo().io);
    const cap = captureIo();
    runCli(["init", root], cap.io);
    expect(cap.out()).toContain("skipped");
    expect(runCli(["init", root, "--force"], captureIo().io)).toBe(0);
  });

  it("adds itself to a Node project's devDependencies", () => {
    const root = tmpRepo({ ...CLEAN, "package.json": '{\n  "name": "demo"\n}\n' });
    runCli(["init", root], captureIo().io);
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.devDependencies.skillcheck).toMatch(/^\^\d+\.\d+\.\d+$/);
  });

  // `init` is meant to be re-run as a repo grows, so the second run is as much
  // a part of the contract as the first.
  describe("re-running", () => {
    const scenariosOf = (root: string) => readFileSync(join(root, "skillcheck.scenarios.yaml"), "utf8");

    it("is a no-op when every skill already has a scenario", () => {
      const root = tmpRepo(CLEAN);
      runCli(["init", root], captureIo().io);
      const first = scenariosOf(root);

      const cap = captureIo();
      expect(runCli(["init", root], cap.io)).toBe(0);
      expect(cap.out()).toContain("every skill already has a scenario");
      expect(scenariosOf(root)).toBe(first);
    });

    it("appends a scenario for a skill added since the last run", () => {
      const root = tmpRepo(CLEAN);
      runCli(["init", root], captureIo().io);
      const before = scenariosOf(root);

      mkdirSync(join(root, "skills/json-tidy"), { recursive: true });
      writeFileSync(
        join(root, "skills/json-tidy/SKILL.md"),
        skillMd(
          "json-tidy",
          "Reformats JSON documents and sorts their keys. Use when the user asks to tidy a JSON file.",
        ),
      );

      const cap = captureIo();
      expect(runCli(["init", root], cap.io)).toBe(0);
      expect(cap.out()).toContain("updated");
      expect(cap.out()).toContain("json-tidy");

      const after = scenariosOf(root);
      expect(after.startsWith(before)).toBe(true); // nothing existing was touched
      expect(after).toContain("expect: json-tidy");

      process.chdir(root);
      expect(runCli(["test"], captureIo().io)).toBe(0); // and it still passes
    });

    it("leaves hand-written scenarios exactly as they were", () => {
      const root = tmpRepo(CLEAN);
      const path = join(root, "skillcheck.scenarios.yaml");
      const handWritten = 'scenarios:\n  - prompt: "my own careful wording"\n    expect: pdf-report\n';
      writeFileSync(path, handWritten);

      expect(runCli(["init", root], captureIo().io)).toBe(0);
      expect(readFileSync(path, "utf8")).toBe(handWritten);
    });

    it("counts a forbid as covering a skill, so it never contradicts one", () => {
      const root = tmpRepo(CLEAN);
      const path = join(root, "skillcheck.scenarios.yaml");
      writeFileSync(path, 'scenarios:\n  - prompt: "something else"\n    forbid: pdf-report\n');

      const cap = captureIo();
      runCli(["init", root], cap.io);
      expect(cap.out()).toContain("every skill already has a scenario");
    });

    it("declines rather than corrupting a file it can't safely append to", () => {
      const root = tmpRepo({
        ...CLEAN,
        // `scenarios:` isn't last, so appending a list item would be invalid YAML.
        "skillcheck.scenarios.yaml": 'scenarios:\n  - prompt: "x"\n    expect: other\nversion: 1\n',
      });
      const path = join(root, "skillcheck.scenarios.yaml");
      const before = readFileSync(path, "utf8");

      const cap = captureIo();
      expect(runCli(["init", root], cap.io)).toBe(0);
      expect(cap.out()).toMatch(/left alone/);
      expect(readFileSync(path, "utf8")).toBe(before);
    });

    it("leaves an unparseable scenarios file alone instead of replacing it", () => {
      const root = tmpRepo({ ...CLEAN, "skillcheck.scenarios.yaml": "scenarios: [oh: no: no\n" });
      const path = join(root, "skillcheck.scenarios.yaml");
      const before = readFileSync(path, "utf8");

      const cap = captureIo();
      expect(runCli(["init", root], cap.io)).toBe(0);
      expect(cap.out()).toMatch(/left alone/);
      expect(readFileSync(path, "utf8")).toBe(before);
    });

    it("reports an unchanged workflow as up to date rather than as a conflict", () => {
      const root = tmpRepo(CLEAN);
      runCli(["init", root], captureIo().io);
      const cap = captureIo();
      runCli(["init", root], cap.io);
      expect(cap.out()).toContain("already up to date");
    });
  });
});

describe("GitHub integration", () => {
  it("publishes step outputs when $GITHUB_OUTPUT is set", () => {
    const root = tmpRepo(BROKEN);
    const outputFile = join(root, "outputs.txt");
    writeFileSync(outputFile, "");
    runCli([root], captureIo({ GITHUB_OUTPUT: outputFile }).io);

    const written = readFileSync(outputFile, "utf8");
    expect(written).toMatch(/score=\d+/);
    expect(written).toMatch(/grade=[A-F]/);
    expect(written).toMatch(/errors=[1-9]/);
  });

  it("appends a markdown report to the job summary", () => {
    const root = tmpRepo(BROKEN);
    const summaryFile = join(root, "summary.md");
    writeFileSync(summaryFile, "");
    runCli([root, "--summary"], captureIo({ GITHUB_STEP_SUMMARY: summaryFile }).io);

    const written = readFileSync(summaryFile, "utf8");
    expect(written).toContain("## skillcheck");
    expect(written).toContain("Skill health");
  });

  it("says so rather than failing when --summary has nowhere to write", () => {
    const cap = captureIo();
    expect(runCli([tmpRepo(CLEAN), "--summary"], cap.io)).toBe(0);
    expect(cap.err()).toContain("GITHUB_STEP_SUMMARY");
  });

  it("emits workflow-command annotations for --format github", () => {
    const cap = captureIo();
    runCli([tmpRepo(BROKEN), "--format", "github"], cap.io);
    expect(cap.out()).toMatch(/::error file=.*,line=\d+::\[name-format\]/);
  });
});

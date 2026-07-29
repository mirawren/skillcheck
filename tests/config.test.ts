import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globToMatcher, loadConfig, numberOption, ConfigError } from "../src/config";
import { runCheck } from "../src/index";
import { render } from "../src/report";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, "fixtures", name);

/** Write a throwaway skill and return its directory. */
function scratchSkill(frontmatter: string, body = "# Skill\n"): string {
  const root = mkdtempSync(join(tmpdir(), "skillcheck-"));
  const dir = join(root, "skills", "widget");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\n${body}`);
  return dir;
}

describe("globToMatcher", () => {
  it("matches ** across segments and * within a segment", () => {
    expect(globToMatcher("**/grill-me/**")("a/b/grill-me/SKILL.md")).toBe(true);
    expect(globToMatcher("skills/*/SKILL.md")("skills/x/SKILL.md")).toBe(true);
    expect(globToMatcher("skills/*/SKILL.md")("skills/x/y/SKILL.md")).toBe(false);
  });
  it("matches a slash-less pattern against the basename", () => {
    expect(globToMatcher("*.md")("deep/nested/notes.md")).toBe(true);
    expect(globToMatcher("SKILL.md")("a/b/SKILL.md")).toBe(true);
  });
  it("escapes regex metacharacters in literals", () => {
    expect(globToMatcher("a.b")("a.b")).toBe(true);
    expect(globToMatcher("a.b")("axb")).toBe(false);
  });
});

describe("numberOption", () => {
  it("returns the option when finite, else the fallback", () => {
    expect(numberOption({ min: 5 }, "min", 20)).toBe(5);
    expect(numberOption({ min: "5" }, "min", 20)).toBe(20);
    expect(numberOption(undefined, "min", 20)).toBe(20);
    expect(numberOption({ min: Infinity }, "min", 20)).toBe(20);
  });
});

describe("config: rule settings", () => {
  it("disables a rule with off", () => {
    const before = runCheck([fixture("bad")]);
    const after = runCheck([fixture("bad")], { rules: { "when-to-use": "off" } });
    expect(before.findings.some((f) => f.ruleId === "when-to-use")).toBe(true);
    expect(after.findings.some((f) => f.ruleId === "when-to-use")).toBe(false);
    expect(after.summary.errors).toBeLessThan(before.summary.errors);
  });

  it("downgrades severity to warning", () => {
    const result = runCheck([fixture("bad")], { rules: { "when-to-use": "warn" } });
    const wtu = result.findings.filter((f) => f.ruleId === "when-to-use");
    expect(wtu.length).toBeGreaterThan(0);
    expect(wtu.every((f) => f.severity === "warning")).toBe(true);
  });

  it("upgrades severity to error", () => {
    const result = runCheck([fixture("bad")], { rules: { "unknown-keys": "error" } });
    const uk = result.findings.filter((f) => f.ruleId === "unknown-keys");
    expect(uk.length).toBeGreaterThan(0);
    expect(uk.every((f) => f.severity === "error")).toBe(true);
  });
});

describe("config: ignore globs", () => {
  it("skips matching skills", () => {
    const result = runCheck([fixture("bad")], { ignore: ["**/grill-me/**"] });
    expect(result.summary.skills).toBe(2);
    expect(result.findings.some((f) => f.file.includes("grill-me"))).toBe(false);
  });
});

describe("config: per-rule options", () => {
  it("tightens the description-length minimum", () => {
    const result = runCheck([fixture("good")], { options: { "description-length": { min: 500 } } });
    expect(result.findings.some((f) => f.ruleId === "description-length")).toBe(true);
  });

  it("relaxes the body-size line budget", () => {
    const body = Array.from({ length: 600 }, () => "line").join("\n");
    const dir = scratchSkill(
      "name: widget\ndescription: Use when the user asks to frob a widget in the editor.",
      body,
    );
    const strict = runCheck([dir]);
    const relaxed = runCheck([dir], { options: { "body-size": { maxLines: 1000 } } });
    expect(strict.findings.some((f) => f.ruleId === "body-size")).toBe(true);
    expect(relaxed.findings.some((f) => f.ruleId === "body-size")).toBe(false);
  });
});

describe("inline suppression via x-skillcheck", () => {
  it("suppresses only the listed rules on that skill", () => {
    const dir = scratchSkill(
      "name: widget\ndescription: Provides comprehensive widget utilities.\nx-skillcheck:\n  disable:\n    - when-to-use",
    );
    const result = runCheck([dir]);
    expect(result.findings.some((f) => f.ruleId === "when-to-use")).toBe(false);
  });

  it("does not flag x-skillcheck itself as an unknown key", () => {
    const dir = scratchSkill(
      "name: widget\ndescription: Use when the user asks to frob a widget somewhere.\nx-skillcheck:\n  disable: []",
    );
    const result = runCheck([dir]);
    expect(result.findings.some((f) => f.ruleId === "unknown-keys")).toBe(false);
  });

  it('disable: "*" suppresses everything on that skill', () => {
    const dir = scratchSkill('name: BAD_NAME\ndescription: x\nx-skillcheck:\n  disable: "*"');
    const result = runCheck([dir]);
    expect(result.findings).toEqual([]);
  });
});

describe("loadConfig", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = process.cwd();
  });
  afterEach(() => {
    process.chdir(cwd);
  });

  it("returns an empty config when none exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "skillcheck-noconf-"));
    process.chdir(dir);
    expect(loadConfig(undefined).config).toEqual({});
  });

  it("discovers skillcheck.config.json by walking up", () => {
    const root = mkdtempSync(join(tmpdir(), "skillcheck-conf-"));
    writeFileSync(join(root, "skillcheck.config.json"), '{"rules":{"body-size":"off"}}');
    const nested = join(root, "a", "b");
    mkdirSync(nested, { recursive: true });
    process.chdir(nested);
    const loaded = loadConfig(undefined);
    expect(loaded.config.rules?.["body-size"]).toBe("off");
    expect(loaded.path).not.toBeNull();
  });

  it("throws ConfigError on an invalid rule setting", () => {
    const root = mkdtempSync(join(tmpdir(), "skillcheck-badconf-"));
    const p = join(root, "skillcheck.config.json");
    writeFileSync(p, '{"rules":{"when-to-use":"loud"}}');
    expect(() => loadConfig(p)).toThrow(ConfigError);
  });

  it("throws ConfigError when an explicit config is missing", () => {
    expect(() => loadConfig("/no/such/skillcheck.config.json")).toThrow(ConfigError);
  });
});

describe("SARIF output", () => {
  const result = runCheck([fixture("bad")]);
  const sarif = JSON.parse(render(result, "sarif", { version: "9.9.9" }));

  it("emits a valid SARIF 2.1.0 skeleton", () => {
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs).toHaveLength(1);
    expect(sarif.runs[0].tool.driver.name).toBe("skillcheck");
    expect(sarif.runs[0].tool.driver.version).toBe("9.9.9");
  });

  it("advertises every rule, including plugin-manifest", () => {
    const ids = sarif.runs[0].tool.driver.rules.map((r: { id: string }) => r.id);
    expect(ids).toContain("when-to-use");
    expect(ids).toContain("plugin-manifest");
  });

  it("maps findings to results with levels and locations", () => {
    const results = sarif.runs[0].results as Array<{
      ruleId: string;
      level: string;
      locations: unknown[];
    }>;
    expect(results.length).toBe(result.findings.length);
    expect(results.every((r) => r.level === "error" || r.level === "warning")).toBe(true);
    expect(results.every((r) => r.locations.length === 1)).toBe(true);
  });

  it("uses forward-slash relative paths", () => {
    const uri = sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri;
    expect(uri).not.toMatch(/\\/);
    expect(uri).not.toMatch(/^\//);
  });
});

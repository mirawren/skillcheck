import { describe, expect, it } from "vitest";
import { badgeColor, computeScore, gradeFor, scoreForCounts } from "../src/score";
import type { CheckResult, Finding } from "../src/types";

function result(findings: Finding[], files: string[]): CheckResult {
  return {
    findings,
    summary: {
      errors: findings.filter((f) => f.severity === "error").length,
      warnings: findings.filter((f) => f.severity === "warning").length,
      skills: files.length,
      plugins: 0,
    },
    files: { skills: files, plugins: [] },
  };
}

const finding = (file: string, severity: "error" | "warning"): Finding => ({
  ruleId: "when-to-use",
  severity,
  message: "x",
  file,
});

describe("scoreForCounts", () => {
  it("costs a grade for one error and much less for a warning", () => {
    expect(scoreForCounts(0, 0)).toBe(100);
    expect(scoreForCounts(1, 0)).toBe(75);
    expect(scoreForCounts(0, 1)).toBe(95);
  });

  it("clamps at zero rather than going negative", () => {
    expect(scoreForCounts(99, 99)).toBe(0);
  });
});

describe("gradeFor", () => {
  it("uses standard cut points", () => {
    expect(gradeFor(100)).toBe("A");
    expect(gradeFor(90)).toBe("A");
    expect(gradeFor(89)).toBe("B");
    expect(gradeFor(70)).toBe("C");
    expect(gradeFor(60)).toBe("D");
    expect(gradeFor(59)).toBe("F");
  });
});

describe("computeScore", () => {
  it("scores an empty scan as clean", () => {
    expect(computeScore(result([], [])).score).toBe(100);
  });

  it("credits clean files instead of averaging only the broken ones", () => {
    const files = ["/a/SKILL.md", "/b/SKILL.md", "/c/SKILL.md", "/d/SKILL.md"];
    const report = computeScore(result([finding("/a/SKILL.md", "error")], files));
    // One 75 and three 100s — not a bare 75.
    expect(report.score).toBe(94);
    expect(report.grade).toBe("A");
  });

  it("lists the worst unit first, so the report doubles as a work list", () => {
    const files = ["/a/SKILL.md", "/b/SKILL.md"];
    const report = computeScore(
      result([finding("/b/SKILL.md", "error"), finding("/b/SKILL.md", "error")], files),
    );
    expect(report.units[0].file).toBe("/b/SKILL.md");
    expect(report.units[0].score).toBe(50);
    expect(report.units[1].score).toBe(100);
  });

  it("ignores findings on files that were never scanned", () => {
    const report = computeScore(result([finding("/ghost/SKILL.md", "error")], ["/a/SKILL.md"]));
    expect(report.score).toBe(100);
  });
});

describe("badgeColor", () => {
  it("maps every grade to a shields.io named color", () => {
    const colors = (["A", "B", "C", "D", "F"] as const).map(badgeColor);
    expect(colors).toEqual(["brightgreen", "green", "yellowgreen", "orange", "red"]);
  });
});

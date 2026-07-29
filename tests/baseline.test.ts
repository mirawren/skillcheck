import { describe, expect, it } from "vitest";
import { applyBaseline, buildBaseline, parseBaseline, BaselineError } from "../src/baseline";
import type { Finding } from "../src/types";

const cwd = "/repo";

const finding = (file: string, ruleId: string, message = "problem"): Finding => ({
  ruleId,
  severity: "error",
  message,
  file: `${cwd}/${file}`,
  line: 3,
});

describe("buildBaseline", () => {
  it("records one entry per distinct finding, with a count", () => {
    const baseline = buildBaseline(
      [
        finding("skills/a/SKILL.md", "when-to-use"),
        finding("skills/a/SKILL.md", "when-to-use"),
        finding("skills/b/SKILL.md", "body-size"),
      ],
      cwd,
    );
    expect(baseline.entries).toHaveLength(2);
    expect(baseline.entries.find((e) => e.rule === "when-to-use")?.count).toBe(2);
  });

  it("stores repo-relative POSIX paths so the file is portable", () => {
    const baseline = buildBaseline([finding("skills/a/SKILL.md", "when-to-use")], cwd);
    expect(baseline.entries[0].file).toBe("skills/a/SKILL.md");
  });

  it("is deterministic — same findings, same bytes", () => {
    const findings = [finding("skills/b/SKILL.md", "z"), finding("skills/a/SKILL.md", "y")];
    expect(JSON.stringify(buildBaseline(findings, cwd))).toBe(
      JSON.stringify(buildBaseline([...findings].reverse(), cwd)),
    );
  });
});

describe("applyBaseline", () => {
  it("hides known findings and lets new ones through", () => {
    const known = finding("skills/a/SKILL.md", "when-to-use");
    const fresh = finding("skills/new/SKILL.md", "when-to-use");
    const outcome = applyBaseline([known, fresh], buildBaseline([known], cwd), cwd);
    expect(outcome.suppressed).toHaveLength(1);
    expect(outcome.remaining).toEqual([fresh]);
  });

  it("hides only as many duplicates as it recorded", () => {
    const one = finding("skills/a/SKILL.md", "broken-references");
    const outcome = applyBaseline([one, one, one], buildBaseline([one, one], cwd), cwd);
    expect(outcome.suppressed).toHaveLength(2);
    expect(outcome.remaining).toHaveLength(1);
  });

  it("ignores line numbers, so edits above a finding don't resurrect it", () => {
    const before = finding("skills/a/SKILL.md", "when-to-use");
    const moved = { ...before, line: 42 };
    const outcome = applyBaseline([moved], buildBaseline([before], cwd), cwd);
    expect(outcome.remaining).toHaveLength(0);
  });

  it("does not confuse two different rules on the same file", () => {
    const a = finding("skills/a/SKILL.md", "when-to-use");
    const b = finding("skills/a/SKILL.md", "body-size");
    const outcome = applyBaseline([a, b], buildBaseline([a], cwd), cwd);
    expect(outcome.remaining).toEqual([b]);
  });

  it("reports entries that no longer occur, so a baseline can't rot silently", () => {
    const gone = finding("skills/fixed/SKILL.md", "when-to-use");
    const outcome = applyBaseline([], buildBaseline([gone], cwd), cwd);
    expect(outcome.stale).toHaveLength(1);
    expect(outcome.stale[0].file).toBe("skills/fixed/SKILL.md");
  });
});

describe("parseBaseline", () => {
  it("rejects malformed files with an actionable message", () => {
    expect(() => parseBaseline("not json", "/repo/b.json")).toThrow(BaselineError);
    expect(() => parseBaseline("[]", "/repo/b.json")).toThrow(/must contain a JSON object/);
    expect(() => parseBaseline('{"entries":"nope"}', "/repo/b.json")).toThrow(/entries/);
    expect(() => parseBaseline('{"entries":[{"file":"a"}]}', "/repo/b.json")).toThrow(/rule/);
  });

  it("defaults a missing count to one", () => {
    const parsed = parseBaseline('{"entries":[{"file":"a","rule":"r","message":"m"}]}', "/b.json");
    expect(parsed.entries[0].count).toBe(1);
  });
});

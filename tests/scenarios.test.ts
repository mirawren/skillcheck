import { afterAll, describe, expect, it } from "vitest";
import { collectDocs } from "../src/index";
import { buildIndex } from "../src/match";
import {
  FORMAT_VERSION,
  parseScenarios,
  runScenarios,
  type Scenario,
  ScenarioError,
  scenarioTemplate,
} from "../src/scenarios";
import { cleanupTmpRepos, skillMd, tmpRepo } from "./helpers";

afterAll(cleanupTmpRepos);

const index = () =>
  buildIndex(
    collectDocs([
      tmpRepo({
        "skills/pdf-extract/SKILL.md": skillMd(
          "pdf-extract",
          "Extracts text from a PDF. Use when the user asks to pull text out of a PDF file.",
        ),
        "skills/invoice-parser/SKILL.md": skillMd(
          "invoice-parser",
          "Parses vendor invoices into structured line items. Use when the user asks to read an invoice.",
        ),
      }),
    ]).skills,
  );

/** Two skills worded so alike that neither can be relied on to win. */
const twins = () =>
  buildIndex(
    collectDocs([
      tmpRepo({
        "skills/grill-me/SKILL.md": skillMd(
          "grill-me",
          "Reviews your code changes for bugs, style issues and missed edge cases before you commit them.",
        ),
        "skills/review-me/SKILL.md": skillMd(
          "review-me",
          "Reviews your code changes for bugs, style problems and missed edge cases before you commit them.",
        ),
      }),
    ]).skills,
  );

/** Build a scenario the way the parser would, so tests state only what they mean. */
const scenario = (prompt: string, fields: Partial<Omit<Scenario, "prompt">> = {}): Scenario => ({
  prompt,
  expect: [],
  forbid: [],
  expectNone: false,
  ...fields,
});

const one = (yaml: string) => parseScenarios(`scenarios:\n${yaml}`, "f.yaml")[0];

describe("parseScenarios", () => {
  it("accepts a scenarios: mapping", () => {
    expect(parseScenarios('scenarios:\n  - prompt: "hi"\n    expect: a\n', "f.yaml")).toEqual([
      { prompt: "hi", expect: ["a"], forbid: [], expectNone: false },
    ]);
  });

  it("accepts a bare list too", () => {
    expect(parseScenarios('- prompt: "hi"\n  expect: a\n', "f.yaml")).toHaveLength(1);
  });

  it("rejects anything else with a message naming the file and the scenario", () => {
    expect(() => parseScenarios("nope", "f.yaml")).toThrow(/scenarios:/);
    expect(() => parseScenarios("scenarios:\n  - expect: a\n", "f.yaml")).toThrow(/scenario 1.*prompt/s);
    expect(() => parseScenarios("scenarios:\n  - [1,2]\n", "f.yaml")).toThrow(ScenarioError);
  });

  it("reads `expect` as one name or a list of acceptable ones", () => {
    expect(one('  - prompt: "hi"\n    expect: a\n').expect).toEqual(["a"]);
    expect(one('  - prompt: "hi"\n    expect: [a, b]\n').expect).toEqual(["a", "b"]);
  });

  it("reads `forbid` the same way, and allows it alongside `expect`", () => {
    expect(one('  - prompt: "hi"\n    forbid: danger\n')).toEqual(
      scenario("hi", { forbid: ["danger"] }),
    );
    expect(one('  - prompt: "hi"\n    expect: a\n    forbid: [x, y]\n')).toEqual(
      scenario("hi", { expect: ["a"], forbid: ["x", "y"] }),
    );
  });

  it("normalizes `expect: none` to its own flag rather than a skill named none", () => {
    const parsed = one('  - prompt: "hi"\n    expect: none\n');
    expect(parsed.expectNone).toBe(true);
    expect(parsed.expect).toEqual([]);
  });

  it("rejects a scenario that asserts nothing at all", () => {
    expect(() => one('  - prompt: "hi"\n')).toThrow(/asserts nothing/);
  });

  it("rejects an unknown key instead of silently ignoring the assertion", () => {
    expect(() => one('  - prompt: "hi"\n    expct: a\n')).toThrow(/unknown key `expct`/);
    expect(() => one('  - prompt: "hi"\n    expect: a\n    only: b\n    also: c\n')).toThrow(
      /unknown keys `only`, `also`/,
    );
  });

  it("rejects contradictions a run could never satisfy", () => {
    expect(() => one('  - prompt: "hi"\n    expect: [none, a]\n')).toThrow(/nothing should fire/);
    expect(() => one('  - prompt: "hi"\n    expect: a\n    forbid: a\n')).toThrow(
      /both expects and forbids `a`/,
    );
  });

  it("rejects an empty or non-string name", () => {
    expect(() => one('  - prompt: "hi"\n    expect: ""\n')).toThrow(/`expect` must be a skill name/);
    expect(() => one('  - prompt: "hi"\n    forbid: [a, 7]\n')).toThrow(/`forbid` must be a skill name/);
  });

  describe("format version", () => {
    it("treats an absent version as the current one", () => {
      expect(parseScenarios('scenarios:\n  - prompt: "hi"\n    expect: a\n', "f.yaml")).toHaveLength(1);
    });

    it("accepts the version it writes", () => {
      expect(
        parseScenarios(
          `version: ${FORMAT_VERSION}\nscenarios:\n  - prompt: "hi"\n    expect: a\n`,
          "f.yaml",
        ),
      ).toHaveLength(1);
    });

    it("refuses a newer file rather than ignoring assertions it can't read", () => {
      expect(() => parseScenarios(`version: ${FORMAT_VERSION + 1}\nscenarios: []\n`, "f.yaml")).toThrow(
        /only understands 1.*Upgrade/s,
      );
    });

    it("rejects a version that isn't a positive integer", () => {
      expect(() => parseScenarios('version: "1"\nscenarios: []\n', "f.yaml")).toThrow(/positive integer/);
      expect(() => parseScenarios("version: 0\nscenarios: []\n", "f.yaml")).toThrow(/positive integer/);
    });
  });
});

describe("runScenarios", () => {
  it("passes when the expected skill wins", () => {
    const [result] = runScenarios(index(), [
      scenario("pull the text out of this pdf", { expect: ["pdf-extract"] }),
    ]);
    expect(result.status).toBe("pass");
    expect(result.actual).toBe("pdf-extract");
  });

  it("fails when a different skill wins, and says which", () => {
    const [result] = runScenarios(index(), [
      scenario("pull the text out of this pdf", { expect: ["invoice-parser"] }),
    ]);
    expect(result.status).toBe("fail");
    expect(result.reason).toContain("pdf-extract");
  });

  it("supports expect: none for requests nothing should claim", () => {
    const [pass] = runScenarios(index(), [scenario("what time is it in Tokyo", { expectNone: true })]);
    expect(pass.status).toBe("pass");

    const [fail] = runScenarios(index(), [scenario("extract text from a pdf", { expectNone: true })]);
    expect(fail.status).toBe("fail");
  });

  it("fails a scenario naming a skill that does not exist", () => {
    const [result] = runScenarios(index(), [scenario("anything", { expect: ["ghost-skill"] })]);
    expect(result.status).toBe("fail");
    expect(result.reason).toContain("no skill named");
  });

  it("flags a win that is too narrow to depend on", () => {
    const [result] = runScenarios(twins(), [
      scenario("review my code changes before I commit", { expect: ["review-me"] }),
    ]);
    expect(result.status).toBe("close");
    expect(result.reason).toMatch(/too close/);
  });

  describe("expect with several acceptable skills", () => {
    it("passes when any of them wins", () => {
      const [result] = runScenarios(index(), [
        scenario("pull the text out of this pdf", { expect: ["invoice-parser", "pdf-extract"] }),
      ]);
      expect(result.status).toBe("pass");
    });

    it("still fails when none of them does, and names the winner", () => {
      const [result] = runScenarios(twins(), [
        scenario("review my code changes before I commit", { expect: ["grill-me"] }),
      ]);
      expect(result.status).toBe("fail");
      expect(result.reason).toContain("review-me ranked first");
    });
  });

  describe("forbid", () => {
    it("passes when the forbidden skill is nowhere near the request", () => {
      const [result] = runScenarios(index(), [
        scenario("pull the text out of this pdf", { forbid: ["invoice-parser"] }),
      ]);
      expect(result.status).toBe("pass");
      expect(result.actual).toBe("pdf-extract");
    });

    it("fails when the forbidden skill takes the request", () => {
      const [result] = runScenarios(index(), [
        scenario("pull the text out of this pdf", { forbid: ["pdf-extract"] }),
      ]);
      expect(result.status).toBe("fail");
      expect(result.reason).toMatch(/pdf-extract must not take this request/);
    });

    it("warns when the forbidden skill is close enough to win on a different day", () => {
      const [result] = runScenarios(twins(), [
        scenario("review my code changes before I commit", { forbid: ["grill-me"] }),
      ]);
      expect(result.status).toBe("close");
      expect(result.reason).toMatch(/grill-me is forbidden and trails review-me by only \d+%/);
    });

    it("reports the forbidden skill first when a scenario both expects and forbids", () => {
      const [result] = runScenarios(twins(), [
        scenario("review my code changes before I commit", {
          expect: ["review-me"],
          forbid: ["grill-me"],
        }),
      ]);
      expect(result.status).toBe("close");
      expect(result.reason).toContain("grill-me is forbidden");
    });

    it("fails a forbid naming a skill that does not exist, rather than passing vacuously", () => {
      const [result] = runScenarios(index(), [scenario("anything", { forbid: ["ghost-skill"] })]);
      expect(result.status).toBe("fail");
      expect(result.reason).toMatch(/no skill named `ghost-skill`/);
    });

    it("passes when nothing matches the request at all", () => {
      const [result] = runScenarios(index(), [
        scenario("what time is it in Tokyo", { forbid: ["pdf-extract"] }),
      ]);
      expect(result.status).toBe("pass");
    });
  });
});

describe("scenarioTemplate", () => {
  it("seeds real skills so the first run passes", () => {
    const yaml = scenarioTemplate([{ name: "pdf-extract", prompt: "pull text out of a PDF" }]);
    const parsed = parseScenarios(yaml, "template");
    expect(parsed[0]).toEqual(scenario("pull text out of a PDF", { expect: ["pdf-extract"] }));
    expect(parsed.at(-1)?.expectNone).toBe(true);
  });

  it("declares the format version it was written for", () => {
    expect(scenarioTemplate([])).toContain(`version: ${FORMAT_VERSION}`);
  });

  it("still produces a valid file for an empty repo", () => {
    expect(parseScenarios(scenarioTemplate([]), "template").length).toBeGreaterThan(0);
  });
});

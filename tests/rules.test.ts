import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runCheck } from "../src/index";
import { bodyNotEmpty } from "../src/rules/body-not-empty";
import { bodySize } from "../src/rules/body-size";
import { brokenReferences } from "../src/rules/broken-references";
import { descriptionThirdPerson } from "../src/rules/description-third-person";
import { noPlaceholders } from "../src/rules/no-placeholders";
import { smartQuotes } from "../src/rules/smart-quotes";
import { unknownKeys } from "../src/rules/unknown-keys";
import { whenToUse } from "../src/rules/when-to-use";
import { catalog } from "../src/rules/index";
import type { CheckContext, SkillDoc } from "../src/types";
import { cleanupTmpRepos, skillMd, tmpRepo } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(here, "fixtures", name);

afterAll(cleanupTmpRepos);

const emptyCtx: CheckContext = { skills: [], options: {} };

function doc(overrides: Partial<SkillDoc>): SkillDoc {
  return {
    dir: "/tmp/skills/example",
    file: "/tmp/skills/example/SKILL.md",
    raw: "",
    frontmatter: { name: "example", description: "" },
    body: "",
    bodyStartLine: 5,
    bodyStartOffset: 0,
    name: "example",
    ...overrides,
  };
}

describe("good fixture", () => {
  it("passes with zero findings", () => {
    const result = runCheck([fixture("good")]);
    expect(result.findings).toEqual([]);
    expect(result.summary.skills).toBe(1);
    expect(result.summary.errors).toBe(0);
  });
});

describe("bad fixture", () => {
  const result = runCheck([fixture("bad")]);
  const ruleIds = new Set(result.findings.map((f) => f.ruleId));

  it("discovers all skills and the plugin manifest", () => {
    expect(result.summary.skills).toBe(3);
    expect(result.summary.plugins).toBe(1);
  });

  it("flags the invalid skill name", () => {
    expect(ruleIds).toContain("name-format");
  });

  it("flags the capability-only description", () => {
    expect(ruleIds).toContain("when-to-use");
  });

  it("flags the too-short description", () => {
    expect(ruleIds).toContain("description-length");
  });

  it("flags near-duplicate descriptions across sibling skills", () => {
    const sim = result.findings.filter((f) => f.ruleId === "description-similarity");
    expect(sim.length).toBeGreaterThan(0);
    expect(sim[0].message).toMatch(/similar to/);
  });

  it("flags the broken relative link", () => {
    const broken = result.findings.filter((f) => f.ruleId === "broken-references");
    expect(broken).toHaveLength(1);
    expect(broken[0].message).toContain("templates/report.html");
  });

  it("flags the typo'd frontmatter key with a suggestion", () => {
    const unknown = result.findings.filter((f) => f.ruleId === "unknown-keys");
    expect(unknown).toHaveLength(1);
    expect(unknown[0].message).toContain("descripton");
    expect(unknown[0].message).toContain("description");
  });

  it("flags the non-semver plugin version", () => {
    const plugin = result.findings.filter((f) => f.ruleId === "plugin-manifest");
    expect(plugin.some((f) => f.message.includes("not valid semver"))).toBe(true);
  });
});

describe("plugin manifest", () => {
  it("accepts the official minimal manifest and only recommends a release version", () => {
    const root = tmpRepo({ ".claude-plugin/plugin.json": '{ "name": "minimal-plugin" }\n' });
    const findings = runCheck([root]).findings.filter((f) => f.ruleId === "plugin-manifest");

    expect(findings.every((f) => f.severity === "warning")).toBe(true);
    expect(findings.some((f) => f.message.includes("`description`"))).toBe(false);
    expect(findings.some((f) => f.message.includes("`version`"))).toBe(true);
  });

  it("accepts a named manifest with a semver release", () => {
    const root = tmpRepo({
      ".claude-plugin/plugin.json": '{ "name": "released-plugin", "version": "1.0.0" }\n',
    });
    const findings = runCheck([root]).findings.filter((f) => f.ruleId === "plugin-manifest");

    expect(findings).toEqual([]);
  });

  it.each(["01.2.3", "1.2.3-alpha..1", "1.2.3-alpha.01", "1.2.3+."])(
    "rejects malformed semver %s",
    (version) => {
      const root = tmpRepo({
        ".claude-plugin/plugin.json": JSON.stringify({ name: "bad-version", version }),
      });
      const findings = runCheck([root]).findings.filter((f) => f.ruleId === "plugin-manifest");

      expect(findings.some((f) => f.message.includes("not valid semver"))).toBe(true);
    },
  );
});

describe("when-to-use", () => {
  it("accepts descriptions with a trigger context", () => {
    const findings = whenToUse.check(
      doc({ description: "Extracts tables from PDFs. Use when the user asks to pull data out of a PDF." }),
      emptyCtx,
    );
    expect(findings).toEqual([]);
  });

  it("rejects capability-only descriptions", () => {
    const findings = whenToUse.check(
      doc({ description: "Provides comprehensive PDF manipulation utilities." }),
      emptyCtx,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("error");
  });
});

describe("body-size", () => {
  it("warns on oversized bodies", () => {
    const body = Array.from({ length: 600 }, () => "line").join("\n");
    const findings = bodySize.check(doc({ body }), emptyCtx);
    expect(findings.some((f) => f.message.includes("600 lines"))).toBe(true);
  });

  it("stays quiet on small bodies", () => {
    expect(bodySize.check(doc({ body: "short body" }), emptyCtx)).toEqual([]);
  });

  it("honors configured thresholds", () => {
    const body = Array.from({ length: 600 }, () => "line").join("\n");
    const ctx: CheckContext = { skills: [], options: { "body-size": { maxLines: 900 } } };
    expect(bodySize.check(doc({ body }), ctx).some((f) => f.message.includes("lines"))).toBe(false);
  });
});

describe("body-not-empty", () => {
  it("flags a body that is only a title", () => {
    const findings = bodyNotEmpty.check(doc({ body: "\n# PDF Tools\n" }), emptyCtx);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warning");
  });

  it("counts prose, not headings, code or link targets", () => {
    const body = "# Title\n\n```js\nconst a = 1;\n```\n\n[link](https://example.com/very/long/path)";
    expect(bodyNotEmpty.check(doc({ body }), emptyCtx)).toHaveLength(1);
  });

  it("accepts a body with real instructions", () => {
    const body = "# Title\n\nCollect the source file, render it, and confirm the page count.";
    expect(bodyNotEmpty.check(doc({ body }), emptyCtx)).toEqual([]);
  });

  it("stays quiet when the frontmatter itself is broken", () => {
    expect(bodyNotEmpty.check(doc({ body: "", parseError: "bad yaml" }), emptyCtx)).toEqual([]);
  });
});

describe("no-placeholders", () => {
  it("catches leftover markers and template tokens", () => {
    const cases = ["TODO: finish this", "lorem ipsum dolor", "use <your-api-key>", "REPLACE_ME"];
    for (const body of cases) {
      expect(noPlaceholders.check(doc({ body }), emptyCtx).length).toBeGreaterThan(0);
    }
  });

  it("does not flag ordinary prose containing those words in context", () => {
    const body = "Todo lists are supported. Replace me with the customer name only when asked.";
    expect(noPlaceholders.check(doc({ body }), emptyCtx)).toEqual([]);
  });

  it("caps how much it reports from one file", () => {
    const body = Array.from({ length: 50 }, (_, i) => `TODO ${i}`).join("\n");
    expect(noPlaceholders.check(doc({ body }), emptyCtx).length).toBeLessThanOrEqual(10);
  });
});

describe("smart-quotes", () => {
  it("flags curly punctuation inside the frontmatter only", () => {
    const raw = '---\nname: demo\ndescription: “Generates reports”\n---\n\n# Body — an em dash is fine here\n';
    const findings = smartQuotes.check(doc({ raw }), emptyCtx);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("2 typographic");
  });

  it("ignores a file with no frontmatter", () => {
    expect(smartQuotes.check(doc({ raw: "# Just prose — with a dash\n" }), emptyCtx)).toEqual([]);
  });
});

describe("description-third-person", () => {
  it("flags assistant-voice descriptions", () => {
    for (const description of [
      "I can help you process Excel files.",
      "Let me walk you through the release.",
      "You can use this to render PDFs.",
    ]) {
      expect(descriptionThirdPerson.check(doc({ description }), emptyCtx)).toHaveLength(1);
    }
  });

  it("accepts third-person descriptions, including ones that mention the user", () => {
    for (const description of [
      "Processes Excel workbooks. Use when the user asks to analyze a spreadsheet.",
      "Renders PDFs from markdown when the user wants a printable artifact.",
    ]) {
      expect(descriptionThirdPerson.check(doc({ description }), emptyCtx)).toEqual([]);
    }
  });
});

describe("broken-references", () => {
  it("ignores URLs, anchors and absolute paths", () => {
    const body =
      "[a](https://example.com) [b](#section) [c](/etc/hosts) [d](mailto:x@example.com)";
    expect(brokenReferences.check(doc({ body }), emptyCtx)).toEqual([]);
  });

  it("resolves relative links against the skill folder", () => {
    const root = tmpRepo({
      "skills/demo/SKILL.md": skillMd("demo", "Demo skill. Use when demoing.", "[t](refs/a.md)"),
      "skills/demo/refs/a.md": "# a",
    });
    expect(runCheck([root]).findings.filter((f) => f.ruleId === "broken-references")).toEqual([]);
  });
});

describe("unknown-keys", () => {
  it("accepts the extended frontmatter real hosts read", () => {
    const frontmatter = {
      name: "demo",
      description: "x",
      "allowed-tools": ["Read"],
      metadata: {},
      license: "MIT",
      "argument-hint": "<file>",
      model: "opus",
      "x-skillcheck": { disable: [] },
    };
    expect(unknownKeys.check(doc({ frontmatter }), emptyCtx)).toEqual([]);
  });

  it("flags a near-miss spelling and names the key it meant", () => {
    const findings = unknownKeys.check(
      doc({ frontmatter: { name: "demo", descripton: "x" } }),
      emptyCtx,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("description");
  });
});

describe("trigger-shadowing", () => {
  const shadowed = {
    "skills/changelog-writer/SKILL.md": skillMd(
      "changelog-writer",
      "Writes a changelog from git history. Use when the user asks for a changelog.",
    ),
    "skills/release-manager/SKILL.md": skillMd(
      "release-manager",
      "Writes a changelog from git history, bumps the version, tags the release and publishes the package. Use when the user asks to cut a release.",
    ),
  };

  it("reports the narrow skill whose vocabulary a broader one already covers", () => {
    const findings = runCheck([tmpRepo(shadowed)]).findings.filter(
      (f) => f.ruleId === "trigger-shadowing",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toContain("changelog-writer");
    expect(findings[0].message).toContain("release-manager");
  });

  it("stays quiet when the specific skill still wins its own words", () => {
    const root = tmpRepo({
      "skills/pdf-extract/SKILL.md": skillMd(
        "pdf-extract",
        "Extracts text from a PDF. Use when the user asks to pull text out of a PDF file.",
      ),
      "skills/document-toolkit/SKILL.md": skillMd(
        "document-toolkit",
        "Extracts text from PDFs, fills PDF forms and merges PDF files. Use whenever the user mentions a document.",
      ),
    });
    expect(runCheck([root]).findings.filter((f) => f.ruleId === "trigger-shadowing")).toEqual([]);
  });

  it("leaves near-duplicate twins to description-similarity", () => {
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
    const ids = runCheck([root]).findings.map((f) => f.ruleId);
    expect(ids).toContain("description-similarity");
    expect(ids).not.toContain("trigger-shadowing");
  });

  it("says nothing about a lone skill", () => {
    const root = tmpRepo({ "skills/solo/SKILL.md": skillMd("solo", "Does one thing. Use when asked to do it.") });
    expect(runCheck([root]).findings.filter((f) => f.ruleId === "trigger-shadowing")).toEqual([]);
  });
});

describe("description-similarity at scale", () => {
  it("reports one finding per skill rather than one per pair", () => {
    // Five identical descriptions would be 10 pairs. A report has to stay
    // readable as a repo grows, so each skill names its worst collision.
    const files: Record<string, string> = {};
    for (let i = 0; i < 5; i++) {
      files[`skills/twin-${i}/SKILL.md`] = skillMd(
        `twin-${i}`,
        "Reviews code changes for bugs and style problems. Use when the user asks for a review.",
      );
    }
    const findings = runCheck([tmpRepo(files)]).findings.filter(
      (f) => f.ruleId === "description-similarity",
    );
    expect(findings).toHaveLength(5);
    expect(findings[0].message).toContain("and 3 other skills");
  });
});

describe("the rule catalog", () => {
  it("documents every check — an undocumented rule gets switched off, not fixed", () => {
    for (const rule of catalog) {
      expect(rule.docs.why.length, `${rule.id} needs a why`).toBeGreaterThan(40);
      expect(rule.summary.length, `${rule.id} needs a summary`).toBeGreaterThan(10);
    }
  });

  it("has unique ids", () => {
    expect(new Set(catalog.map((r) => r.id)).size).toBe(catalog.length);
  });
});

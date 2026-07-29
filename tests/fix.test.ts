import { afterAll, describe, expect, it } from "vitest";
import { applyEdits, fixDocs, fixableRules, fixText } from "../src/fix";
import { collectDocs, evaluate } from "../src/index";
import { parseSkillText } from "../src/parse";
import { rules } from "../src/rules/index";
import type { CheckContext } from "../src/types";
import { cleanupTmpRepos, tmpRepo } from "./helpers";

afterAll(cleanupTmpRepos);

const ctx: CheckContext = { skills: [], options: {} };
const fixers = fixableRules(rules);

function fixed(text: string): string {
  return fixText("/tmp/skills/example/SKILL.md", text, fixers, ctx).output;
}

describe("applyEdits", () => {
  it("applies non-overlapping edits in order", () => {
    const result = applyEdits("hello world", [
      { start: 0, end: 5, text: "goodbye" },
      { start: 6, end: 11, text: "there" },
    ]);
    expect(result.output).toBe("goodbye there");
    expect(result.applied).toBe(2);
  });

  it("inserts without deleting when start === end", () => {
    expect(applyEdits("ab", [{ start: 1, end: 1, text: "X" }]).output).toBe("aXb");
  });

  it("skips an overlapping edit instead of corrupting the text", () => {
    const result = applyEdits("abcdef", [
      { start: 0, end: 3, text: "X" },
      { start: 1, end: 4, text: "Y" },
    ]);
    expect(result.output).toBe("Xdef");
    expect(result.skipped).toBe(1);
  });

  it("ignores edits pointing outside the text", () => {
    expect(applyEdits("abc", [{ start: 5, end: 9, text: "!" }]).output).toBe("abc");
  });
});

describe("name-format autofix", () => {
  it("normalizes an invalid name to kebab-case", () => {
    const output = fixed("---\nname: PDF_Tools\ndescription: Extracts text.\n---\n\n# Body\n");
    expect(output).toContain("name: pdf-tools");
  });

  it("rewrites a quoted value without leaving stray quotes", () => {
    const output = fixed('---\nname: "PDF Tools"\ndescription: Extracts text.\n---\n\n# Body\n');
    expect(output).toContain("name: pdf-tools");
    expect(output).not.toContain('"pdf-tools"');
  });

  it("leaves a value with an inline comment alone rather than clobbering it", () => {
    const source = "---\nname: PDF_Tools # legacy\ndescription: Extracts text.\n---\n\n# Body\n";
    expect(fixed(source)).toBe(source);
  });
});

describe("unknown-keys autofix", () => {
  it("renames a typo'd key to the real one", () => {
    const output = fixed("---\nname: demo\ndescripton: Extracts text.\n---\n\n# Body\n");
    expect(output).toContain("description: Extracts text.");
  });

  it("refuses to rename onto a key that already exists", () => {
    // Renaming here would silently destroy the real description.
    const source = "---\nname: demo\ndescription: Real one.\ndescripton: Stray.\n---\n\n# Body\n";
    expect(fixed(source)).toBe(source);
  });
});

describe("smart-quotes autofix", () => {
  const curly = `---\nname: demo\ndescription: “Generates reports” — use when asked\n---\n\n# Body — keep this dash\n`;

  it("replaces typographic characters in the frontmatter", () => {
    const output = fixed(curly);
    expect(output).toContain('"Generates reports"');
    expect(output).toContain("- use when asked");
  });

  it("leaves the body's prose punctuation untouched", () => {
    expect(fixed(curly)).toContain("# Body — keep this dash");
  });
});

describe("the fix loop", () => {
  it("is idempotent — a second pass changes nothing", () => {
    const once = fixed("---\nname: PDF_Tools\ndescripton: Extracts text.\n---\n\n# Body\n");
    expect(fixed(once)).toBe(once);
  });

  it("reports which rules did the work", () => {
    const outcome = fixText(
      "/tmp/skills/x/SKILL.md",
      "---\nname: PDF_Tools\ndescription: Extracts text.\n---\n\n# Body\n",
      fixers,
      ctx,
    );
    expect(outcome.changed).toBe(true);
    expect(outcome.fixedRuleIds).toContain("name-format");
    expect(outcome.hitCap).toBe(false);
  });

  it("preserves CRLF line endings", () => {
    const output = fixed("---\r\nname: PDF_Tools\r\ndescription: Extracts text.\r\n---\r\n\r\n# Body\r\n");
    expect(output).toContain("\r\n");
    expect(output).toContain("name: pdf-tools");
  });

  it("leaves a file with no frontmatter completely alone", () => {
    const source = "# Just markdown\n\nNo frontmatter here.\n";
    expect(fixed(source)).toBe(source);
  });

  it("only produces text that still parses", () => {
    const output = fixed("---\nname: PDF_Tools\ndescription: Extracts text.\n---\n\n# Body\n");
    const doc = parseSkillText("/tmp/skills/x/SKILL.md", output);
    expect(doc.parseError).toBeUndefined();
    expect(doc.name).toBe("pdf-tools");
  });
});

describe("fixDocs", () => {
  it("honors a per-skill x-skillcheck opt-out", () => {
    const root = tmpRepo({
      "skills/keep-me/SKILL.md":
        "---\nname: KEEP_ME\ndescription: Kept as is. Use when asked.\nx-skillcheck:\n  disable: [name-format]\n---\n\n# Body\n",
      "skills/fix-me/SKILL.md": "---\nname: FIX_ME\ndescription: Fixed. Use when asked.\n---\n\n# Body\n",
    });
    const { skills } = collectDocs([root]);
    const results = fixDocs(
      skills,
      (doc) => (doc.name === "KEEP_ME" ? [] : fixers),
      { skills, options: {} },
    );
    const changed = results.filter((r) => r.changed).map((r) => r.file);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toContain("fix-me");
  });

  it("actually removes the findings it claims to fix", () => {
    const root = tmpRepo({
      "skills/pdf-tools/SKILL.md":
        "---\nname: PDF_Tools\ndescription: Extracts text from PDFs. Use when the user asks for a PDF.\n---\n\n# Body\n\nRead it and return the text.\n",
    });
    const before = collectDocs([root]);
    expect(evaluate(before.skills, before.manifests).findings.map((f) => f.ruleId)).toContain(
      "name-format",
    );

    const results = fixDocs(before.skills, () => fixers, { skills: before.skills, options: {} });
    const patched = before.skills.map((doc, i) => parseSkillText(doc.file, results[i].after));
    expect(evaluate(patched, before.manifests).findings.map((f) => f.ruleId)).not.toContain(
      "name-format",
    );
  });
});

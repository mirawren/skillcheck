import { afterAll, describe, expect, it } from "vitest";
import { collectDocs } from "../src/index";
import { buildIndex, distinctiveTerms, idf, matchPrompt, rank } from "../src/match";
import { stem, termSet, tokenize } from "../src/text";
import { cleanupTmpRepos, skillMd, tmpRepo } from "./helpers";

afterAll(cleanupTmpRepos);

function indexOf(files: Record<string, string>) {
  const root = tmpRepo(files);
  return buildIndex(collectDocs([root]).skills);
}

describe("stemming", () => {
  it("folds regular plurals", () => {
    expect(stem("files")).toBe("file");
    expect(stem("pdfs")).toBe("pdf");
    expect(stem("queries")).toBe("query");
    expect(stem("boxes")).toBe("box");
    expect(stem("classes")).toBe("class");
  });

  it("folds -ing and -ed onto the same stem as the base verb", () => {
    expect(stem("converting")).toBe(stem("converted"));
    expect(stem("generating")).toBe("generate");
    expect(stem("running")).toBe("run");
  });

  it("leaves short words that merely end in a suffix alone", () => {
    // The classic over-stemming trap: "string" must not become "str".
    expect(stem("string")).toBe("string");
    expect(stem("css")).toBe("css");
    expect(stem("bed")).toBe("bed");
  });
});

describe("tokenizing", () => {
  it("drops stopwords, including the trigger vocabulary itself", () => {
    const terms = tokenize("Use this skill when the user asks to convert a PDF");
    expect(terms).not.toContain("use");
    expect(terms).not.toContain("when");
    expect(terms).not.toContain("skill");
    expect(terms).toContain("pdf");
    expect(terms).toContain("convert");
  });

  it("splits hyphenated and punctuated text into terms", () => {
    expect(termSet("pdf-report, v2!")).toEqual(new Set(["pdf", "report", "v2"]));
  });

  it("keeps duplicates for term frequency but dedupes in termSet", () => {
    expect(tokenize("pdf pdf pdf")).toHaveLength(3);
    expect(termSet("pdf pdf pdf").size).toBe(1);
  });
});

describe("idf at the scale real repos actually have", () => {
  it("stays positive for a term present in every skill of a two-skill repo", () => {
    const index = indexOf({
      "skills/a/SKILL.md": skillMd("a", "Handles pdf files. Use when asked about a pdf."),
      "skills/b/SKILL.md": skillMd("b", "Also handles pdf files. Use when asked about a pdf."),
    });
    // Textbook BM25 idf would be <= 0 here and silently erase the only signal.
    expect(idf(index, "pdf")).toBeGreaterThan(0);
  });

  it("scores a rare term above a common one", () => {
    const index = indexOf({
      "skills/a/SKILL.md": skillMd("a", "Renders invoices. Use when asked for an invoice."),
      "skills/b/SKILL.md": skillMd("b", "Renders receipts. Use when asked for a receipt."),
      "skills/c/SKILL.md": skillMd("c", "Renders statements. Use when asked for a statement."),
    });
    expect(idf(index, "invoice")).toBeGreaterThan(idf(index, "render"));
  });
});

describe("ranking", () => {
  const files = {
    "skills/pdf-extract/SKILL.md": skillMd(
      "pdf-extract",
      "Extracts text from a PDF. Use when the user asks to pull text out of a PDF file.",
    ),
    "skills/invoice-parser/SKILL.md": skillMd(
      "invoice-parser",
      "Parses vendor invoices into structured line items. Use when the user asks to read an invoice.",
    ),
  };

  it("puts the intended skill first for a request in its own words", () => {
    const report = matchPrompt(indexOf(files), "pull the text out of this pdf");
    expect(report.matches[0].name).toBe("pdf-extract");
    expect(report.verdict).toBe("clear");
  });

  it("reports which request terms produced the match", () => {
    const [top] = rank(indexOf(files), "parse this vendor invoice");
    expect(top.name).toBe("invoice-parser");
    expect(top.matched).toContain("invoice");
  });

  it("returns `none` for a request no skill covers", () => {
    const report = matchPrompt(indexOf(files), "what time is it in Tokyo");
    expect(report.verdict).toBe("none");
    expect(report.matches).toHaveLength(0);
  });

  it("measures coverage over the terms that could have matched, not every word", () => {
    // A real request is mostly words no description will ever contain. Counting
    // those against the winner made coverage a measure of how conversationally
    // the question was asked, and reported a sole 100%-share winner as
    // "no skill covers this" — failing a build about the right answer.
    const report = matchPrompt(indexOf(files), "hey can you help me quickly parse this invoice again");
    expect(report.verdict).toBe("clear");
    expect(report.matches[0].name).toBe("invoice-parser");
    expect(report.unmatchable).toEqual(["hey", "help", "quickly"]);
  });

  it("still returns `none` when the repo shares no vocabulary with the request", () => {
    const report = matchPrompt(indexOf(files), "book a flight to Berlin");
    expect(report.verdict).toBe("none");
    expect(report.coverage).toBe(0);
  });

  it("calls a near-tie a coin flip rather than picking a winner", () => {
    const report = matchPrompt(
      indexOf({
        "skills/grill-me/SKILL.md": skillMd(
          "grill-me",
          "Reviews your code changes for bugs, style issues and missed edge cases before you commit them.",
        ),
        "skills/review-me/SKILL.md": skillMd(
          "review-me",
          "Reviews your code changes for bugs, style problems and missed edge cases before you commit them.",
        ),
      }),
      "review my code changes before I commit",
    );
    expect(report.verdict).toBe("close");
    expect(report.margin).toBeLessThan(0.15);
  });

  it("is deterministic — the same corpus and request give the same ranking", () => {
    const index = indexOf(files);
    const once = rank(index, "extract text from a pdf").map((m) => m.name);
    const twice = rank(index, "extract text from a pdf").map((m) => m.name);
    expect(once).toEqual(twice);
  });

  it("shares add up to the whole", () => {
    const report = matchPrompt(indexOf(files), "extract text from an invoice pdf");
    const total = report.matches.reduce((sum, m) => sum + m.share, 0);
    expect(total).toBeCloseTo(1, 5);
  });
});

describe("distinctiveTerms", () => {
  it("ignores the skill's own name, which nothing else could ever cover", () => {
    const index = indexOf({
      "skills/changelog-writer/SKILL.md": skillMd(
        "changelog-writer",
        "Writes a changelog from git history.",
      ),
      "skills/other/SKILL.md": skillMd("other", "Formats spreadsheets into printable tables."),
    });
    const terms = distinctiveTerms(index, index.skills[0]);
    expect(terms).toContain("changelog");
    expect(terms).not.toContain("writer");
  });
});

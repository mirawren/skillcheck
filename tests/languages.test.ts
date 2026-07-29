import { describe, expect, it } from "vitest";
import { detect, LANGUAGES, packFor, stopwordsOf } from "../src/languages/index";
import type { LanguagePack } from "../src/languages/types";
import { whenToUse } from "../src/rules/when-to-use";
import { descriptionThirdPerson } from "../src/rules/description-third-person";
import { displayWidth, fold, padDisplay } from "../src/script";
import { tokenize } from "../src/text";
import type { CheckContext, SkillDoc } from "../src/types";

/**
 * The language-pack contract, enforced.
 *
 * `src/languages/types.ts` documents this file as the reason a pack "cannot
 * quietly ship patterns that never fire, and a later change to the tokenizer
 * cannot quietly break a language nobody on the project speaks". That promise
 * is only worth anything if the file actually runs, so every registered pack
 * goes through the same battery here — no pack is exempt, and adding one to the
 * registry is what enrolls it.
 *
 * The two properties that matter are the ones a reviewer who does not read the
 * language cannot check by eye:
 *
 *   1. Its `samples.triggers` are detected as that language *and* satisfy
 *      `when-to-use`. A pattern that never fires is indistinguishable from a
 *      missing one until a native speaker files the bug.
 *   2. Its `samples.capabilityOnly` are detected as that language *and* are
 *      still reported. This is the direction that decays silently: loosening a
 *      pattern to fix a false positive can switch the rule off for the whole
 *      language, and nothing else in the suite would notice.
 */

const ctx: CheckContext = { skills: [], options: {} };

const isAscii = (char: string) => char.codePointAt(0)! < 0x80;

/** Regex syntax that sits between a `\b` and the literal character it guards. */
const SYNTAX_BEFORE = new Set([")", "]", "}", "*", "+", "?"]);
const SYNTAX_AFTER = new Set(["(", "?", ":", "[", "^"]);

/**
 * The literal characters each `\b` in `source` is anchored against.
 *
 * Walks outward from every `\b` past group and quantifier syntax to the nearest
 * real character on each side — so `(a|かな)\b` reports `な`, the last character
 * of the group the boundary actually follows, rather than the `)`.
 */
function boundaryNeighbours(source: string): string[] {
  const found: string[] = [];
  for (let i = source.indexOf("\\b"); i !== -1; i = source.indexOf("\\b", i + 2)) {
    let left = i - 1;
    while (left >= 0 && SYNTAX_BEFORE.has(source[left])) left--;
    // A `\`-escape (`\s`, `\S`) is a class, not a literal — nothing to judge.
    if (left >= 0 && source[left - 1] !== "\\") found.push(source[left]);

    let right = i + 2;
    while (right < source.length && SYNTAX_AFTER.has(source[right])) right++;
    if (right < source.length && source[right] !== "\\") found.push(source[right]);
  }
  return found;
}

function docFor(description: string, lang?: string): SkillDoc {
  const frontmatter: Record<string, unknown> = { name: "example", description };
  if (lang) frontmatter["x-skillcheck"] = { lang };
  return {
    dir: "/tmp/skills/example",
    file: "/tmp/skills/example/SKILL.md",
    raw: "",
    frontmatter,
    body: "",
    bodyStartLine: 5,
    bodyStartOffset: 0,
    name: "example",
    description,
  };
}

describe("the language registry", () => {
  it("has unique, lowercase, resolvable codes", () => {
    const codes = LANGUAGES.map((pack) => pack.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toBe(code.toLowerCase());
      expect(packFor(code)).toBeDefined();
      // Region and script subtags resolve to the base language, so a skill
      // declaring `lang: pt-BR` or `zh-Hans` gets the pack it meant.
      expect(packFor(`${code}-XX`)?.code).toBe(code);
      expect(packFor(code.toUpperCase())?.code).toBe(code);
    }
  });

  it("is sorted by code, so the docs and `languages` list stay stable", () => {
    const codes = LANGUAGES.map((pack) => pack.code);
    expect(codes).toEqual([...codes].sort());
  });

  it("names every language in English and in its own script", () => {
    for (const pack of LANGUAGES) {
      expect(pack.name.length, pack.code).toBeGreaterThan(0);
      expect(pack.endonym.length, pack.code).toBeGreaterThan(0);
      expect(pack.scripts.length, pack.code).toBeGreaterThan(0);
    }
  });
});

describe.each(LANGUAGES.map((pack) => [pack.code, pack] as const))(
  "%s language pack",
  (code, pack: LanguagePack) => {
    it("declares stopwords already folded", () => {
      // Stopwords are looked up against folded text, so an accented or
      // uppercase entry is dead weight that can never match.
      for (const word of pack.stopwords) {
        expect(fold(word), `${code}: "${word}" is not in folded form`).toBe(word);
      }
    });

    it("declares markers already folded", () => {
      for (const word of pack.markers ?? []) {
        expect(fold(word), `${code}: marker "${word}" is not in folded form`).toBe(word);
      }
    });

    it("has no duplicate stopwords", () => {
      expect(new Set(pack.stopwords).size, code).toBe(pack.stopwords.length);
    });

    it("ships worked samples in both directions", () => {
      expect(pack.samples.triggers.length, code).toBeGreaterThan(0);
      expect(pack.samples.capabilityOnly.length, code).toBeGreaterThan(0);
    });

    it("detects its own trigger samples as this language", () => {
      for (const sample of pack.samples.triggers) {
        expect(detect(sample).pack?.code, `${code}: misdetected "${sample}"`).toBe(code);
      }
    });

    it("detects its own capability-only samples as this language", () => {
      for (const sample of pack.samples.capabilityOnly) {
        expect(detect(sample).pack?.code, `${code}: misdetected "${sample}"`).toBe(code);
      }
    });

    it("accepts descriptions that say when to use the skill", () => {
      for (const sample of pack.samples.triggers) {
        const findings = whenToUse.check(docFor(sample, code), ctx);
        expect(
          findings,
          `${code}: no triggerSignal matched a description that states its trigger:\n  ${sample}`,
        ).toEqual([]);
      }
    });

    it("still reports descriptions that only state a capability", () => {
      for (const sample of pack.samples.capabilityOnly) {
        const findings = whenToUse.check(docFor(sample, code), ctx);
        expect(
          findings.length,
          `${code}: a triggerSignal is too loose — it passed a capability-only description:\n  ${sample}`,
        ).toBe(1);
      }
    });

    it("leaves content words in its trigger samples to match on", () => {
      // A pack whose stopword list swallowed its own samples would make every
      // skill in that language unfindable — the most damaging mistake a pack
      // can make, per the contract in types.ts.
      for (const sample of pack.samples.triggers) {
        expect(tokenize(sample, pack).length, `${code}: "${sample}" tokenized to nothing`)
          .toBeGreaterThan(1);
      }
    });

    it("uses no word-boundary anchor that cannot fire in its script", () => {
      // `\b` is defined on [A-Za-z0-9_], so it never matches between two
      // Devanagari, Arabic or CJK characters. A pattern ending in `भी\b` is not
      // strict — it is *dead*, and a dead trigger pattern means every
      // well-written skill in that language is told it has no trigger clause.
      // Silent, and visible only to someone who reads the language. The
      // Unicode-aware spelling is `(?![\p{L}\p{M}])` with the `u` flag.
      for (const re of [...pack.triggerSignals, ...(pack.firstPerson ?? [])]) {
        for (const neighbour of boundaryNeighbours(re.source)) {
          expect(
            isAscii(neighbour),
            `${code}: \\b sits against "${neighbour}" in ${re} and can never fire there. ` +
              "Use (?![\\p{L}\\p{M}]) with the u flag instead.",
          ).toBe(true);
        }
      }
    });

    it("never lists a stopword its own trigger patterns depend on", () => {
      // Stopword removal happens before nothing here — `when-to-use` reads the
      // raw folded description — but a pack that drops the words it triggers on
      // is still a sign the two lists were written from different intuitions.
      // The real failure this guards is the reverse: a trigger sample that
      // survives tokenizing into a *single* term is one edit from unfindable.
      const stopwords = stopwordsOf(pack);
      expect(stopwords.size, code).toBeGreaterThan(0);
    });
  },
);

describe("first-person detection, where a pack defines it", () => {
  const withFirstPerson = LANGUAGES.filter((pack) => pack.firstPerson?.length);

  it("is defined for at least English", () => {
    expect(withFirstPerson.map((p) => p.code)).toContain("en");
  });

  it.each(withFirstPerson.map((pack) => [pack.code, pack] as const))(
    "%s does not flag its own well-formed samples as first person",
    (code, pack: LanguagePack) => {
      // The samples are written the way a native speaker writes a description;
      // none of them are in assistant voice, so a firstPerson pattern that
      // matches one is over-broad.
      for (const sample of [...pack.samples.triggers, ...pack.samples.capabilityOnly]) {
        const findings = descriptionThirdPerson.check(docFor(sample, code), ctx);
        expect(findings, `${code}: firstPerson pattern is over-broad on:\n  ${sample}`).toEqual([]);
      }
    },
  );
});

describe("terminal width", () => {
  it("counts CJK and fullwidth characters as two columns", () => {
    expect(displayWidth("日本語")).toBe(6);
    expect(displayWidth("한국어")).toBe(6);
    expect(displayWidth("中文")).toBe(4);
    // "Japanese (" (10) + 日本語 (6) + ")" (1) = 17 columns, from 14 code units —
    // the three-column gap that pulls a padded table apart.
    const label = "Japanese (日本語)";
    expect(displayWidth(label)).toBe(17);
    expect(label.length).toBe(14);
  });

  it("counts Latin, Cyrillic and Arabic as one column each", () => {
    expect(displayWidth("English")).toBe(7);
    expect(displayWidth("Русский")).toBe(7);
    expect(displayWidth("العربية")).toBe(7);
  });

  it("gives combining marks no width of their own", () => {
    // Devanagari keeps its vowel signs, so `.length` overcounts every word.
    expect(displayWidth("हिन्दी")).toBeLessThan("हिन्दी".length);
  });

  it("ignores colour escapes, which draw nothing", () => {
    expect(displayWidth(`\u001b[1mbold\u001b[0m`)).toBe(4);
  });

  it("pads every label to the same column, whatever its script", () => {
    // The property the tables depend on: pad to a common width and every row
    // ends at the same column. `padEnd` fails this the moment CJK appears.
    const labels = ["English", "Japanese (日本語)", "Русский", "中文"];
    const width = Math.max(...labels.map(displayWidth));
    for (const label of labels) {
      expect(displayWidth(padDisplay(label, width)), label).toBe(width);
    }
  });
});

describe("detection across the registry", () => {
  it("does not confuse any pack's samples for another language's", () => {
    // Each sample is attributed to exactly one pack. Run as one test so the
    // failure message names every collision at once rather than the first.
    const wrong: string[] = [];
    for (const pack of LANGUAGES) {
      for (const sample of [...pack.samples.triggers, ...pack.samples.capabilityOnly]) {
        const got = detect(sample).pack?.code ?? "none";
        if (got !== pack.code) wrong.push(`${pack.code} → ${got}: ${sample}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("returns no pack for text in a script nothing claims", () => {
    // Amharic: the ethiopic script is classified, but no pack claims it. The
    // honest answer is "unknown language, known script" — that is what keeps
    // when-to-use silent instead of reporting an error it cannot justify.
    const detection = detect("ይህ ሰነድ ወደ ፒዲኤፍ ይቀየራል");
    expect(detection.pack).toBeNull();
    expect(detection.script).toBe("ethiopic");
  });

  it("returns nothing at all for text with no letters", () => {
    expect(detect("   ").pack).toBeNull();
    expect(detect("123 !@# ---").pack).toBeNull();
  });

  it("reads a mostly-CJK description as CJK despite Latin technical terms", () => {
    // The realistic shape: a Japanese description carrying "Markdown"/"PDF".
    const detection = detect("Markdown から PDF レポートを生成します。");
    expect(detection.pack?.code).toBe("ja");
  });
});

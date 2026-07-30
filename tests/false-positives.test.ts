import { afterAll, describe, expect, it } from "vitest";
import { runCheck } from "../src/index";
import { buildIndex, matchPrompt } from "../src/match";
import { parseSkillText } from "../src/parse";
import { cleanupTmpRepos, tmpRepo } from "./helpers";

afterAll(cleanupTmpRepos);

/**
 * Regression tests for findings this tool reported on files that were correct.
 *
 * These are kept together, and kept separate from the per-rule tests, because
 * they are a different kind of assertion. A per-rule test says "this rule
 * catches the thing it is for". Every test here says "this rule stopped
 * flagging a file that a real author wrote correctly" — the failure the README
 * calls existential, since a linter that cries wolf gets deleted and takes
 * every other rule with it.
 *
 * Each case below was a live finding on a shipped version, most at error
 * severity. Adding a rule or broadening a pattern must not bring any of them
 * back, and the cheapest way to guarantee that is to make it a red build.
 */

function findingsFor(files: Record<string, string>): string[] {
  return runCheck([tmpRepo(files)]).findings.map((f) => `${f.ruleId}/${f.severity}`);
}

describe("when-to-use, on descriptions that plainly state a trigger", () => {
  it("accepts an emphatic trigger that doesn't use the words 'use when'", () => {
    // The shape used by a widely installed skill. The rule required literally
    // "use this skill when", so this was reported as having no trigger at all,
    // at error severity, on a description whose second clause is nothing but a
    // trigger.
    expect(
      findingsFor({
        "skills/brainstorming/SKILL.md": `---
name: brainstorming
description: Collaborative idea refinement through Socratic questioning. You MUST use this before any creative work - designing systems, writing plans, or exploring solutions.
---

# Brainstorming

Ask one question at a time. Do not propose a solution until the user has.
`,
      }),
    ).toEqual([]);
  });

  it("accepts a trigger placed in the when_to_use frontmatter field", () => {
    // `when_to_use` is a field hosts read, is listed in unknown-keys' allowlist,
    // and is already indexed by the ranking. Reading the description alone meant
    // telling an author who used the field built for this exact purpose that
    // their skill "never says when to use" it.
    expect(
      findingsFor({
        "skills/pdf-export/SKILL.md": `---
name: pdf-export
description: Renders markdown to a paginated PDF with the house template.
when_to_use: Use when the user asks to export a document as a PDF or wants a printable report.
---

# PDF export

Render the document, then confirm the page count before returning it.
`,
      }),
    ).toEqual([]);
  });

  it("still reports a description that only advertises a capability", () => {
    // The other half of the contract: broadening the patterns must not switch
    // the flagship rule off.
    expect(
      findingsFor({
        "skills/pdf-tools/SKILL.md": `---
name: pdf-tools
description: Provides a comprehensive set of utilities for manipulating PDF documents and extracting their tables.
---

# PDF tools

Read the file, extract the tables, and return them as CSV.
`,
      }),
    ).toContain("when-to-use/error");
  });
});

describe("when-to-use, on descriptions that only state a capability", () => {
  // The other direction. Broadening the English patterns to accept an emphatic
  // trigger once made all of these pass — the flagship rule switching itself
  // off, which is worse than the false positive the broadening fixed. These are
  // also in the English pack's `capabilityOnly` samples, where the language
  // contract tests enforce them; asserted here too because this file is where
  // anyone touching a pattern will look.
  const CAPABILITY_ONLY = [
    "Provides a toolkit for use in data pipelines and ETL jobs.",
    "Use the toolkit for extracting tables from scanned documents.",
    "Proactively monitors the build queue and caches build artifacts.",
    "A library of helpers that should be applied consistently across the codebase.",
    "Automates deployment operations for this repository.",
    "Comprehensive PDF utilities for use in reporting workflows.",
  ];

  for (const description of CAPABILITY_ONLY) {
    it(`still reports: ${description.slice(0, 44)}…`, () => {
      expect(
        findingsFor({
          "skills/thing/SKILL.md": `---\nname: thing\ndescription: ${description}\n---\n\n# thing\n\nRead the input, do the work, report what changed.\n`,
        }),
      ).toContain("when-to-use/error");
    });
  }
});

describe("body rules, on skills that document an example", () => {
  it("ignores a dead link and a TODO inside a fenced code block", () => {
    // A review skill whose job is to flag leftover markers earned a
    // broken-references *error* and a no-placeholders warning for containing an
    // example of one. A fenced block is exactly where a deliberately broken
    // sample belongs.
    expect(
      findingsFor({
        "skills/review-checklist/SKILL.md": `---
name: review-checklist
description: Reviews a diff against the team checklist. Use when the user asks for a code review before merging.
---

# Review checklist

Flag any leftover markers. A file with problems looks like this:

\`\`\`markdown
See [the template](templates/missing.html) for details.
TODO: finish this section
\`\`\`

Report each occurrence with its line number.
`,
      }),
    ).toEqual([]);
  });

  it("ignores a placeholder inside an inline code span", () => {
    expect(
      findingsFor({
        "skills/env-setup/SKILL.md": `---
name: env-setup
description: Explains the environment variables a deployment needs. Use when the user asks how to configure a deploy.
---

# Environment setup

Never commit a literal \`TODO\` or \`<your-api-key>\` — read both from the environment instead.
`,
      }),
    ).toEqual([]);
  });

  it("ignores a fenced block nested in a list item or a blockquote", () => {
    // The two places a skill body actually puts a code sample. A fence inside a
    // numbered step is indented to the item's content column, and a quoted one
    // is prefixed `> ` — a three-column indent cap rejected both, so the block
    // was never entered and the false positive still fired at error severity on
    // the shape a body mostly consists of.
    expect(
      findingsFor({
        "skills/reviewer/SKILL.md": `---
name: reviewer
description: Reviews a diff against the team checklist. Use when the user asks for a code review before merging.
---

# Reviewer

1. Read the body and flag any leftover markers. A bad file looks like this:

    \`\`\`markdown
    See [the template](templates/missing.html) for details.
    TODO: finish this section
    \`\`\`

2. Report each one with its line number.

> Quoted example:
>
> \`\`\`markdown
> See [another](templates/gone.html).
> FIXME: also this
> \`\`\`
`,
      }),
    ).toEqual([]);
  });

  it("keeps checking after an unclosed fence rather than going quiet", () => {
    // CommonMark says an unclosed fence runs to the end of the document, and
    // being right about that would let one stray ``` line switch two rules off
    // for the rest of the body. A linter fails open: a stray fence is likelier
    // than a deliberate one, and a dismissible finding beats a silent check.
    const findings = findingsFor({
      "skills/stray-fence/SKILL.md": `---
name: stray-fence
description: Generates a report. Use when the user asks for the weekly report.
---

# Stray fence

Here is a snippet:

\`\`\`sh
npm run report

See [the template](templates/missing.hbs) for the layout.

TODO: finish this section
`,
    });
    expect(findings).toContain("broken-references/error");
    expect(findings).toContain("no-placeholders/warning");
  });

  it("still reports a real dead link and a real leftover marker in prose", () => {
    const findings = findingsFor({
      "skills/half-written/SKILL.md": `---
name: half-written
description: Generates a report from the template. Use when the user asks for the weekly report.
---

# Half written

See [the template](templates/missing.hbs) for the layout.

TODO: document the retry behaviour before shipping this.
`,
    });
    expect(findings).toContain("broken-references/error");
    expect(findings).toContain("no-placeholders/warning");
  });
});

describe("unknown-keys, on deliberate vendor extensions", () => {
  it("accepts an x- prefixed key, the convention skillcheck itself uses", () => {
    expect(
      findingsFor({
        "skills/vendor/SKILL.md": `---
name: vendor
description: Does the vendor thing. Use when the user asks for the vendor thing.
x-my-tool:
  setting: true
---

# Vendor

Read the setting, then do the vendor thing with it.
`,
      }),
    ).toEqual([]);
  });

  it("still reports a near-miss of skillcheck's own suppression key", () => {
    // `x-skillchek:` silently suppresses nothing, which is the invisible-typo
    // failure this rule exists for — so the vendor exemption stops short of it.
    expect(
      findingsFor({
        "skills/typo/SKILL.md": `---
name: typo
description: Does a thing. Use when the user asks for the thing.
x-skillchek:
  disable: [body-size]
---

# Typo

Read the input and do the thing with it.
`,
      }),
    ).toContain("unknown-keys/warning");
  });
});

describe("description-similarity, on repos with a house description style", () => {
  /** N skills about unrelated technologies, written to one shared template. */
  function houseStyle(topics: readonly string[]): Record<string, string> {
    return Object.fromEntries(
      topics.map((topic) => [
        `skills/${topic}/SKILL.md`,
        `---
name: ${topic}
description: Automates ${topic} operations for this repository. Use when the user asks to inspect, configure or troubleshoot ${topic}.
---

# ${topic}

Read the config, apply the change, then verify the result.
`,
      ]),
    );
  }

  it("stays silent on ten unrelated topics sharing a template", () => {
    // The tool's largest false positive, at error severity: every one of these
    // was reported as 88% similar and impossible to tell apart — ten errors,
    // grade C, build failed — while the ranking gave a kubernetes request to
    // kubernetes by 89% over 1%. Six words of shared boilerplate are not
    // evidence of a collision; overlap is now weighted by how rare each shared
    // word is in the repo.
    expect(
      findingsFor(
        houseStyle(["pdf", "kubernetes", "stripe", "figma", "changelog", "docker", "terraform", "postgres", "redis", "sentry"]),
      ),
    ).toEqual([]);
  });

  it("stays silent from four skills, the point where the corpus can identify boilerplate", () => {
    expect(findingsFor(houseStyle(["pdf", "kubernetes", "stripe", "figma"]))).toEqual([]);
  });

  it("keeps the plain term ratio below four skills, and says why in the rule", () => {
    // The documented limit, asserted rather than left implicit. Rarity weighting
    // works by noticing that a word in most descriptions carries no information,
    // and with three skills every shared term is in most of them by arithmetic —
    // so the weighting has nothing to discount and would instead discount the
    // evidence. Measured: two genuinely near-duplicate skills alone in a repo
    // score 0.34 weighted against 0.80 unweighted, and reporting nothing there
    // would miss the most common shape of this failure — someone's first two
    // skills. A small all-boilerplate repo being reported is the cost.
    expect(findingsFor(houseStyle(["pdf", "kubernetes", "stripe"]))).not.toEqual([]);
  });

  it("still reports two near-duplicate skills alone in a repo", () => {
    const findings = findingsFor({
      "skills/invoice-read/SKILL.md":
        "---\nname: invoice-read\ndescription: Parses a vendor invoice and extracts the billing lines for a client. Use when the user asks to read an invoice.\n---\n\n# invoice-read\n\nRead the file and pull the lines out.\n",
      "skills/invoice-check/SKILL.md":
        "---\nname: invoice-check\ndescription: Parses a vendor invoice and pulls the billing totals for a client. Use when the user asks to check an invoice.\n---\n\n# invoice-check\n\nRead the file and total the lines.\n",
    });
    expect(findings.filter((f) => f.startsWith("description-similarity"))).toHaveLength(2);
  });

  it("still errors on the same skill written twice in synonyms", () => {
    const findings = findingsFor({
      "skills/grill-me/SKILL.md": `---
name: grill-me
description: Reviews your code changes for bugs, style issues and missed edge cases before you commit them to the repo.
---

# grill-me

Read the diff and report every problem, harshly.
`,
      "skills/review-me/SKILL.md": `---
name: review-me
description: Reviews your code changes for bugs, style problems and missed edge cases before you commit them to the repository.
---

# review-me

Read the diff and report the problems, with a line reference for each.
`,
      "skills/terraform/SKILL.md": `---
name: terraform
description: Formats Terraform files. Use when the user asks to tidy infrastructure code.
---

# terraform

Run the formatter, then show what changed.
`,
    });
    expect(findings.filter((f) => f.startsWith("description-similarity"))).toEqual([
      "description-similarity/error",
      "description-similarity/error",
    ]);
  });

  it("names the words doing the colliding, rarest first", () => {
    // A percentage and a filename left the author to diff two sentences by eye.
    const result = runCheck([
      tmpRepo({
        "skills/a/SKILL.md":
          "---\nname: a\ndescription: Parses a vendor invoice and extracts the billing lines for a client. Use when the user asks to read an invoice.\n---\n\n# a\n\nRead it.\n",
        "skills/b/SKILL.md":
          "---\nname: b\ndescription: Parses a vendor invoice and pulls the billing totals for a client. Use when the user asks to check an invoice.\n---\n\n# b\n\nRead it.\n",
      }),
    ]);
    const finding = result.findings.find((f) => f.ruleId === "description-similarity");
    expect(finding?.message).toMatch(/ on: .*(invoice|billing|client)/);
  });
});

describe("the ranking, on requests phrased the way people actually ask", () => {
  const corpus = [
    parseSkillText(
      "/r/skills/stripe-webhooks/SKILL.md",
      "---\nname: stripe-webhooks\ndescription: Configures Stripe webhook endpoints and verifies signatures. Use when the user asks to add or debug a Stripe webhook.\n---\n\n# s\n\nSteps.\n",
    ),
    parseSkillText(
      "/r/skills/pdf-report/SKILL.md",
      "---\nname: pdf-report\ndescription: Generates PDF reports from markdown. Use when the user asks to export results as a PDF.\n---\n\n# p\n\nSteps.\n",
    ),
  ];

  it("does not report a sole 100%-share winner as reaching nothing", () => {
    // "help", "set" and "new" occur in no description and never will. Counted
    // against the winner they outvoted the one word that decided the ranking,
    // so `skillcheck test` failed a build with "nothing matched the request"
    // about the skill that is plainly the answer.
    const report = matchPrompt(buildIndex(corpus), "help me set up a new webhook");
    expect(report.verdict).toBe("clear");
    expect(report.matches[0].name).toBe("stripe-webhooks");
    expect(report.coverage).toBe(1);
  });

  it("still reports nothing for a request the repo has no vocabulary for", () => {
    const report = matchPrompt(buildIndex(corpus), "what time is it in Tokyo");
    expect(report.verdict).toBe("none");
    expect(report.matches).toEqual([]);
  });

  it("names the words that could not have matched, so a win on thin evidence shows", () => {
    const report = matchPrompt(buildIndex(corpus), "help me set up a new webhook");
    expect(report.unmatchable).toEqual(["help", "set", "new"]);
  });
});

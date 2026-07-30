import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { proseLines } from "../markdown.js";
import type { Finding, Rule } from "../types.js";

// Markdown links/images with a relative target: [text](path) / ![alt](path)
const LINK_RE = /!?\[[^\]]*\]\(([^)\s#?]+)[^)]*\)/g;

function isRelativePath(target: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false; // URL scheme
  if (target.startsWith("/")) return false; // absolute — host-dependent, skip
  if (target.startsWith("#")) return false; // in-page anchor
  return true;
}

/**
 * Skills routinely ship with references/, scripts/, templates/ alongside
 * SKILL.md. A body that points the model at a file that doesn't exist fails
 * silently at runtime — the model just follows a dead pointer.
 */
export const brokenReferences: Rule = {
  id: "broken-references",
  summary: "relative links in the body point at files that actually exist",
  docs: {
    why: "Skills routinely ship references/, scripts/ and templates/ next to SKILL.md and point the model at them. A path that doesn't exist fails at runtime, on the user's machine, with no error you'll ever see — the model reads a dead pointer and improvises.",
    bad: "See [the template](templates/report.html) for the layout.",
    good: "See [the template](templates/report.hbs) for the layout.  # the file that is actually committed",
  },
  check(doc) {
    const findings: Finding[] = [];
    // Prose only. A skill that documents a path, or shows what a broken link
    // looks like, puts it in a fenced block — and this rule is an *error*, so
    // reading code samples made it the most expensive false positive in the set.
    const lines = proseLines(doc.body);
    lines.forEach((lineText, i) => {
      if (lineText === null) return;
      for (const match of lineText.matchAll(LINK_RE)) {
        const target = match[1];
        if (!isRelativePath(target)) continue;
        const abs = resolve(doc.dir, decodeURIComponent(target));
        if (!existsSync(abs)) {
          findings.push({
            ruleId: this.id,
            severity: "error",
            message: `links to \`${target}\`, which does not exist in the skill folder`,
            file: doc.file,
            line: doc.bodyStartLine + i,
            detail:
              "The model will try to read this path at runtime and silently fail. Fix the path or add the file.",
          });
        }
      }
    });
    return findings;
  },
};

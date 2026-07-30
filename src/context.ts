import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEAD_REFERENCE_DETAIL } from "./rules/broken-references.js";
import { contextSize } from "./rules/context-size.js";
import { scanPlaceholders, scanReferences } from "./scan.js";
import type { CheckContext, ContextDoc, ContextRule, Finding } from "./types.js";

/**
 * `AGENTS.md` and `CLAUDE.md` — the other text a coding agent reads.
 *
 * skillcheck's thesis is that agent instructions fail *quietly*: nothing errors,
 * the model just behaves differently than you meant. A skill fails that way when
 * it isn't chosen. A context file fails that way when it points at a file that
 * was renamed, or when it has grown to the point that the instruction that
 * matters is buried among four hundred lines that don't.
 *
 * Neither is visible in review, both are checkable offline, and the checks are
 * ones already written — so what is new here is the document kind, not the
 * rules. Two of the three reuse their skill-side rule id on purpose: it is the
 * same defect with the same fix, and a repo that switched `broken-references`
 * off should not still get half of it.
 *
 * The two filenames are treated identically because their failure modes are.
 * Which hosts read which file changes; that a dead `@import` is silently dropped
 * does not.
 */

/** Filenames read as context files. Order is the order they are reported in. */
export const CONTEXT_FILENAMES = ["AGENTS.md", "CLAUDE.md"] as const;

const CONTEXT_FILENAME_SET: ReadonlySet<string> = new Set(CONTEXT_FILENAMES);

/** Whether a basename is a context file skillcheck reads. */
export function isContextFilename(name: string): boolean {
  return CONTEXT_FILENAME_SET.has(name);
}

/**
 * Read one context file. `root` records whether an agent starting at a scanned
 * root would load it unconditionally — see {@link ContextDoc.root}.
 */
export function parseContext(file: string, root: boolean): ContextDoc {
  let raw = "";
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    // An unreadable file yields an empty document rather than throwing: one bad
    // permission bit should not take down a whole run.
  }
  const dir = dirname(file);
  return {
    file,
    dir,
    raw,
    body: raw,
    bodyStartLine: 1,
    kind: file.slice(dir.length + 1),
    root,
  };
}

/** Relative links and `@path` imports that point at nothing. */
const contextReferences: ContextRule = {
  id: "broken-references",
  summary: "relative links and @imports in a context file point at files that exist",
  check(doc): Finding[] {
    return scanReferences(doc, {
      ruleId: this.id,
      severity: "error",
      where: "in this repository",
      detail: DEAD_REFERENCE_DETAIL,
      imports: true,
    });
  },
};

const contextPlaceholders: ContextRule = {
  id: "no-placeholders",
  summary: "a context file ships no TODO/FIXME/placeholder leftovers",
  check(doc): Finding[] {
    return scanPlaceholders(doc, {
      ruleId: this.id,
      subject: doc.kind,
      detail:
        "The agent reads this file at the start of every session, whether or not it is relevant to the request. Unfinished markers get followed or confuse it.",
    });
  },
};

/**
 * Checks that run over context files, in report order.
 *
 * Deliberately short. Everything here names a failure that is silent at runtime
 * — this project's bar for shipping a rule at all — and nothing here is a style
 * opinion about how someone should write instructions to their own agent.
 */
export const contextRules: ContextRule[] = [contextSize, contextReferences, contextPlaceholders];

/** Run every enabled context rule over `docs`. */
export function checkContexts(
  docs: readonly ContextDoc[],
  ctx: CheckContext,
  ruleSettings: Record<string, string> | undefined,
): Finding[] {
  const active = contextRules.filter((rule) => ruleSettings?.[rule.id] !== "off");
  const findings: Finding[] = [];
  for (const doc of docs) {
    for (const rule of active) findings.push(...rule.check(doc, ctx));
  }
  return findings;
}

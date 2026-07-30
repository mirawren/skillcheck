import { numberOption } from "../config.js";
import { estimateTokens } from "../tokens.js";
import type { ContextRule, Finding, RuleInfo } from "../types.js";

/**
 * Half a skill body's budget, because a context file is paid twice as often.
 *
 * The Agent Skills spec recommends a body stay under 500 lines and ~5k tokens —
 * a cost paid when the skill *fires*. An AGENTS.md is paid when the session
 * *starts*, whether or not anything fires, on every request that follows.
 * Halving the on-demand budget is the plainest defensible derivation, and both
 * numbers are configurable for repos that have decided otherwise.
 */
const DEFAULT_MAX_LINES = 250;
const DEFAULT_MAX_TOKENS = 2500;

/** `RuleInfo` too: this id is its own catalog entry, so `docs` is required. */
export const contextSize: ContextRule & RuleInfo = {
  id: "context-size",
  summary: "AGENTS.md / CLAUDE.md stays inside a budget paid on every request",
  docs: {
    why: "An AGENTS.md or CLAUDE.md is loaded before the user's first word and carried by every request in the session — unlike a skill body, which costs nothing until the model chooses it. Everything in it competes for attention with the actual task, so reference material that is only occasionally needed belongs in a file the agent opens on demand, or in a skill that has to earn its activation.",
    bad: `# AGENTS.md

<600 lines: full API reference, every environment variable, the changelog>`,
    good: `# AGENTS.md

Build: \`npm run build\`. Test: \`npm test\`. Never edit \`dist/\`.
Full API reference: [docs/api.md](docs/api.md) — read it when you touch the client.`,
  },
  options: [
    {
      name: "maxLines",
      type: "number",
      default: DEFAULT_MAX_LINES,
      description: "Lines allowed before warning.",
    },
    {
      name: "maxTokens",
      type: "number",
      default: DEFAULT_MAX_TOKENS,
      description: "Estimated tokens allowed before warning (script-aware estimate).",
    },
  ],
  check(doc, ctx): Finding[] {
    const opts = ctx.options[this.id];
    const maxLines = numberOption(opts, "maxLines", DEFAULT_MAX_LINES);
    const maxTokens = numberOption(opts, "maxTokens", DEFAULT_MAX_TOKENS);
    const findings: Finding[] = [];

    const lines = doc.body.split(/\r?\n/).length;
    const tokens = estimateTokens(doc.body);
    const when = doc.root
      ? "before the user's first word, in every session"
      : "whenever the agent works in this directory";

    if (lines > maxLines) {
      findings.push({
        ruleId: this.id,
        severity: "warning",
        message: `${doc.kind} is ${lines.toLocaleString()} lines (skillcheck budgets <${maxLines.toLocaleString()})`,
        file: doc.file,
        line: 1,
        detail: `All of it is loaded ${when}. Move reference material into files the agent opens on demand, and link to them from here.`,
      });
    }
    if (tokens > maxTokens) {
      findings.push({
        ruleId: this.id,
        severity: "warning",
        message: `${doc.kind} is ~${tokens.toLocaleString()} tokens, estimated (skillcheck budgets <${maxTokens.toLocaleString()})`,
        file: doc.file,
        line: 1,
        detail: `Every token here is paid ${when}, before anything the user asks for. \`skillcheck budget\` shows it next to everything else that is always in context.`,
      });
    }
    return findings;
  },
};

import { numberOption } from "../config.js";
import { estimateTokens } from "../tokens.js";
import type { Rule } from "../types.js";

const DEFAULT_MAX_LINES = 500;
const DEFAULT_MAX_TOKENS = 5000;

export const bodySize: Rule = {
  id: "body-size",
  summary: "body stays inside the spec's recommended budget (<500 lines, <~5k tokens)",
  docs: {
    why: "The whole body is loaded into context every time the skill fires, in every session, for every user. Reference material that is only occasionally needed belongs in a separate file inside the skill folder — hosts read those on demand, so the cost is paid only when it's used.",
    bad: `# API Guide

<400 lines of endpoint reference inlined here>`,
    good: `# API Guide

Look up the endpoint in [references/endpoints.md](references/endpoints.md), then follow the request recipe below.`,
  },
  options: [
    { name: "maxLines", type: "number", default: DEFAULT_MAX_LINES, description: "Body lines allowed before warning." },
    { name: "maxTokens", type: "number", default: DEFAULT_MAX_TOKENS, description: "Estimated body tokens allowed before warning (~4 chars/token)." },
  ],
  check(doc, ctx) {
    const opts = ctx.options[this.id];
    const maxLines = numberOption(opts, "maxLines", DEFAULT_MAX_LINES);
    const maxTokens = numberOption(opts, "maxTokens", DEFAULT_MAX_TOKENS);
    const findings = [];
    const lines = doc.body.split(/\r?\n/).length;
    const tokens = estimateTokens(doc.body);
    if (lines > maxLines) {
      findings.push({
        ruleId: this.id,
        severity: "warning" as const,
        message: `body is ${lines} lines (spec recommends <${maxLines})`,
        file: doc.file,
        line: doc.bodyStartLine,
        detail:
          "Long bodies are loaded in full every time the skill fires. Move reference material into linked files inside the skill folder; hosts load those on demand.",
      });
    }
    if (tokens > maxTokens) {
      findings.push({
        ruleId: this.id,
        severity: "warning" as const,
        message: `body is ~${tokens.toLocaleString()} tokens, estimated (spec recommends <${maxTokens.toLocaleString()})`,
        file: doc.file,
        line: doc.bodyStartLine,
        detail:
          "Every token here is paid on every activation, in every session. Estimate assumes ~4 chars/token.",
      });
    }
    return findings;
  },
};

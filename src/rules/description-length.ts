import { numberOption } from "../config.js";
import type { Rule } from "../types.js";

const DEFAULT_MAX = 1024; // agentskills.io spec maximum
const DEFAULT_MIN = 20;

export const descriptionLength: Rule = {
  id: "description-length",
  summary: "`description` is ≤1024 chars (spec) and long enough to be matchable",
  docs: {
    why: "Over the spec's ceiling, a host may reject the skill or truncate the description mid-sentence — and the truncated half is usually the trigger clause at the end. Far under it, there aren't enough distinct words for any request to match against.",
    bad: "description: PDF tools.",
    good: "description: Extracts text and tables from PDF files. Use when the user asks to pull data out of a PDF, read a scanned document, or convert a PDF to markdown.",
  },
  options: [
    { name: "min", type: "number", default: DEFAULT_MIN, description: "Shortest description that won't be warned about, in characters." },
    { name: "max", type: "number", default: DEFAULT_MAX, description: "Spec maximum description length, in characters." },
  ],
  check(doc, ctx) {
    if (!doc.description) return [];
    const opts = ctx.options[this.id];
    const max = numberOption(opts, "max", DEFAULT_MAX);
    const min = numberOption(opts, "min", DEFAULT_MIN);
    const len = doc.description.length;
    if (len > max) {
      return [
        {
          ruleId: this.id,
          severity: "error" as const,
          message: `\`description\` is ${len} chars (spec maximum is ${max})`,
          file: doc.file,
          line: 1,
        },
      ];
    }
    if (len < min) {
      return [
        {
          ruleId: this.id,
          severity: "warning" as const,
          message: `\`description\` is only ${len} chars — too little signal for the model to match against a request`,
          file: doc.file,
          line: 1,
          detail:
            "Descriptions this short are a leading cause of skills that never trigger. Say what the skill does AND when to use it.",
        },
      ];
    }
    return [];
  },
};

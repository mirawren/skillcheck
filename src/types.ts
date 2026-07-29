export type Severity = "error" | "warning";

export interface Finding {
  ruleId: string;
  severity: Severity;
  message: string;
  /** Absolute path of the offending file. */
  file: string;
  /** 1-indexed line, when the finding anchors to one. */
  line?: number;
  /** Optional longer explanation / fix hint shown in pretty output. */
  detail?: string;
}

export interface SkillDoc {
  /** Absolute path of the skill directory. */
  dir: string;
  /** Absolute path of the SKILL.md file. */
  file: string;
  /** The complete, unmodified file text — the substrate autofixers edit. */
  raw: string;
  /** Parsed frontmatter, or null when missing/unparseable. */
  frontmatter: Record<string, unknown> | null;
  /** Parse error text when frontmatter could not be parsed. */
  parseError?: string;
  /** Markdown body (everything after the closing frontmatter fence). */
  body: string;
  /** 1-indexed line where the body starts. */
  bodyStartLine: number;
  /** Character offset in `raw` where the body starts (for autofix edits). */
  bodyStartOffset: number;
  name?: string;
  description?: string;
}

/**
 * A single, character-range replacement into a file's raw text. Autofixers
 * emit these; the fix engine applies non-overlapping edits and re-runs until
 * the file stabilizes (see src/fix.ts).
 */
export interface TextEdit {
  /** Inclusive start offset into the file's raw text. */
  start: number;
  /** Exclusive end offset. `start === end` inserts without deleting. */
  end: number;
  /** Replacement text. */
  text: string;
}

export interface PluginManifest {
  /** Absolute path of plugin.json. */
  file: string;
  json: Record<string, unknown> | null;
  parseError?: string;
}

export interface CheckContext {
  /** Every discovered skill — cross-skill rules (e.g. similarity) need the full set. */
  skills: SkillDoc[];
  /**
   * Per-rule options from config (thresholds etc.), keyed by rule id.
   * Rules read their own entry via `numberOption(ctx.options[this.id], …)`.
   */
  options: Record<string, Record<string, unknown>>;
}

/** A tunable a rule reads from `options[ruleId]` in skillcheck.config.json. */
export interface RuleOption {
  name: string;
  type: "number" | "string" | "boolean";
  default: number | string | boolean;
  description: string;
}

/**
 * Teaching material for a rule. Required, because a lint rule nobody
 * understands gets switched off: this is what `skillcheck explain <rule>`
 * prints, what the generated rule reference in docs/rules.md is built from, and
 * what SARIF ships as `help` — all from this single source, so they can't drift.
 */
export interface RuleDocs {
  /** The concrete failure this rule prevents. Two sentences, no hedging. */
  why: string;
  /** A minimal example that trips the rule. */
  bad?: string;
  /** The same example, corrected. */
  good?: string;
}

export interface Rule {
  id: string;
  /** One-line summary shown in --help and the README rules table. */
  summary: string;
  /** Why the rule exists, with a before/after example. */
  docs: RuleDocs;
  /** Config knobs this rule honors, for the generated docs. */
  options?: RuleOption[];
  /**
   * When true, this rule can mechanically repair (some of) its findings.
   * Surfaced in `--list-rules` and reports so users know `--fix` will help.
   */
  fixable?: boolean;
  check(doc: SkillDoc, ctx: CheckContext): Finding[];
  /**
   * Optional autofix. Returns non-overlapping {@link TextEdit}s into `doc.raw`
   * for the safe, mechanical subset of this rule's findings — or `[]` when
   * nothing can be repaired. Only "safe" fixes belong here (no semantic
   * guesswork); the engine re-parses and re-runs after applying, so a fixer
   * may address one issue per pass and rely on the next pass for the rest.
   */
  fix?(doc: SkillDoc, ctx: CheckContext): TextEdit[];
}

/**
 * A rule's presentable metadata, without its implementation — so checks that
 * aren't rules (the plugin-manifest checks) can still be listed, explained and
 * documented alongside them.
 */
export type RuleInfo = Pick<Rule, "id" | "summary" | "docs" | "options" | "fixable">;

export interface Summary {
  errors: number;
  warnings: number;
  skills: number;
  plugins: number;
}

export interface CheckResult {
  findings: Finding[];
  summary: Summary;
  /**
   * Absolute paths of every scanned unit, so scoring can credit clean files
   * (a skill with zero findings scores 100 and must still count toward the
   * average). Populated by {@link runCheck}.
   */
  files: {
    skills: string[];
    plugins: string[];
  };
}

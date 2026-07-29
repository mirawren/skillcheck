import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, parse as parsePath, resolve } from "node:path";

/**
 * How a rule is treated. `off` disables it; `warn`/`error` force that
 * severity regardless of what the rule itself emits; `on` keeps the rule's
 * own severity (the default when a rule is unlisted).
 */
export type RuleSetting = "off" | "on" | "warn" | "warning" | "error";

export interface SkillcheckConfig {
  /** Per-rule enable/severity overrides, keyed by rule id. */
  rules?: Record<string, RuleSetting>;
  /** Per-rule numeric/string options (thresholds), keyed by rule id. */
  options?: Record<string, Record<string, unknown>>;
  /** Glob patterns; matching SKILL.md / plugin.json paths are skipped. */
  ignore?: string[];
}

/** The config file name auto-discovered by walking up from the working dir. */
export const CONFIG_FILENAME = "skillcheck.config.json";

export interface LoadedConfig {
  config: SkillcheckConfig;
  /** Absolute path the config was read from, or null when none was found. */
  path: string | null;
}

/**
 * Resolve the effective config. When `explicitPath` is given it must exist.
 * Otherwise we walk up from `cwd` looking for `skillcheck.config.json`;
 * an absent file is not an error — an empty config is returned.
 */
export function loadConfig(explicitPath: string | undefined, cwd = process.cwd()): LoadedConfig {
  const path = explicitPath
    ? isAbsolute(explicitPath)
      ? explicitPath
      : resolve(cwd, explicitPath)
    : findConfigUpward(cwd);

  if (!path) return { config: {}, path: null };
  if (!existsSync(path)) {
    throw new ConfigError(`config file not found: ${explicitPath ?? path}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new ConfigError(`${path} is not valid JSON: ${(err as Error).message}`);
  }
  return { config: validateConfig(parsed, path), path };
}

function findConfigUpward(from: string): string | null {
  let dir = resolve(from);
  const root = parsePath(dir).root;
  for (;;) {
    const candidate = resolve(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    if (dir === root) return null;
    dir = dirname(dir);
  }
}

const VALID_SETTINGS: ReadonlySet<string> = new Set(["off", "on", "warn", "warning", "error"]);

function validateConfig(raw: unknown, path: string): SkillcheckConfig {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError(`${path} must contain a JSON object`);
  }
  const obj = raw as Record<string, unknown>;
  const config: SkillcheckConfig = {};

  if (obj.rules !== undefined) {
    if (!isPlainObject(obj.rules)) throw new ConfigError(`${path}: "rules" must be an object`);
    for (const [id, setting] of Object.entries(obj.rules)) {
      if (typeof setting !== "string" || !VALID_SETTINGS.has(setting)) {
        throw new ConfigError(
          `${path}: rules["${id}"] must be one of off, on, warn, error (got ${JSON.stringify(setting)})`,
        );
      }
    }
    config.rules = obj.rules as Record<string, RuleSetting>;
  }

  if (obj.options !== undefined) {
    if (!isPlainObject(obj.options)) throw new ConfigError(`${path}: "options" must be an object`);
    for (const [id, opts] of Object.entries(obj.options)) {
      if (!isPlainObject(opts)) throw new ConfigError(`${path}: options["${id}"] must be an object`);
    }
    config.options = obj.options as Record<string, Record<string, unknown>>;
  }

  if (obj.ignore !== undefined) {
    if (!Array.isArray(obj.ignore) || obj.ignore.some((p) => typeof p !== "string")) {
      throw new ConfigError(`${path}: "ignore" must be an array of strings`);
    }
    config.ignore = obj.ignore as string[];
  }

  return config;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Thrown for malformed config; the CLI maps this to exit code 2. */
export class ConfigError extends Error {}

/**
 * Read a numeric per-rule option, falling back to `fallback` when unset or
 * not a finite number. Rules use this so config thresholds stay optional.
 */
export function numberOption(
  options: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
): number {
  const value = options?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Compile an ignore glob into a matcher over cwd-relative POSIX paths.
 * Supports `*` (within a segment), `**` (across segments) and `?`.
 * A pattern with no `/` also matches on the path's basename, so `*.md`
 * or a bare skill folder name works without spelling out the full path.
 */
export function globToMatcher(pattern: string): (relPath: string) => boolean {
  const re = globToRegExp(pattern);
  const matchesBasename = !pattern.includes("/");
  return (relPath) => {
    const posix = relPath.split("\\").join("/");
    if (re.test(posix)) return true;
    if (matchesBasename) {
      const base = posix.slice(posix.lastIndexOf("/") + 1);
      return re.test(base);
    }
    return false;
  };
}

function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` matches zero or more path segments; `**` alone matches anything.
        if (pattern[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

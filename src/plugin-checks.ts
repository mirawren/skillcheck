import type { Finding, PluginManifest, RuleInfo } from "./types.js";

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function isSemver(value: string): boolean {
  const match = SEMVER_RE.exec(value);
  if (!match) return false;
  const prerelease = match[4];
  return !prerelease?.split(".").some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"));
}

/**
 * Manifest checks aren't a {@link Rule} (they run over plugin.json, not a
 * SkillDoc), but they report under a rule id and must appear everywhere rules
 * do: `--list-rules`, `explain`, the generated docs, SARIF.
 */
export const pluginManifestInfo: RuleInfo = {
  id: "plugin-manifest",
  summary: "plugin.json is valid, named, and versioned deliberately",
  docs: {
    why: "Claude Code's plugin manifest is optional and, when present, only `name` is required. A published plugin should usually add a semver `version`: without one, Claude falls back to the git commit SHA, so every commit is treated as a new version. Leaving it unset is useful during active development, but should be deliberate.",
    bad: `{
  "version": "not-semver"
}`,
    good: `{
  "name": "my-plugin",
  "version": "1.0.0"
}`,
  },
};

/** Minimal manifest checks for Claude Code plugins (.claude-plugin/plugin.json). */
export function checkPluginManifest(manifest: PluginManifest): Finding[] {
  const findings: Finding[] = [];
  const at = (severity: "error" | "warning", message: string, detail?: string) =>
    findings.push({ ruleId: "plugin-manifest", severity, message, file: manifest.file, line: 1, detail });

  if (manifest.parseError || !manifest.json) {
    at("error", manifest.parseError ?? "plugin.json could not be parsed");
    return findings;
  }
  const json = manifest.json;
  if (typeof json.name !== "string" || json.name.length === 0) {
    at("error", "plugin.json is missing the required `name` field");
  }
  if (json.version === undefined) {
    at(
      "warning",
      "plugin.json has no `version` field — Claude will use the git commit SHA",
      "For a published plugin, add `\"version\": \"1.0.0\"` and bump it deliberately. Leave it unset only when treating every commit as a new version is intentional.",
    );
  } else if (typeof json.version !== "string" || !isSemver(json.version)) {
    at("error", `plugin.json \`version: ${String(json.version)}\` is not valid semver (expected e.g. 1.2.3)`);
  }
  return findings;
}

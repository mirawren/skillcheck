import type { Finding, PluginManifest, RuleInfo } from "./types.js";

const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z-.]+)?(\+[0-9A-Za-z-.]+)?$/;

/**
 * Manifest checks aren't a {@link Rule} (they run over plugin.json, not a
 * SkillDoc), but they report under a rule id and must appear everywhere rules
 * do: `--list-rules`, `explain`, the generated docs, SARIF.
 */
export const pluginManifestInfo: RuleInfo = {
  id: "plugin-manifest",
  summary: "plugin.json has the required fields and a valid semver version",
  docs: {
    why: "A manifest missing `name` or `description` won't install. One without a `version` is worse than it looks: consumers have nothing to pin, so every push ships to everyone immediately and there is no way to say 'stay on the version that worked'.",
    bad: `{
  "name": "my-plugin",
  "version": "not-semver"
}`,
    good: `{
  "name": "my-plugin",
  "description": "Skills for generating and reviewing PDF reports.",
  "version": "0.1.0"
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
  if (typeof json.description !== "string" || json.description.length === 0) {
    at("error", "plugin.json is missing the required `description` field");
  }
  if (json.version === undefined) {
    at(
      "warning",
      "plugin.json has no `version` field — users get a new 'version' on every commit SHA",
      "Without semver, installs are unpinnable and every push ships immediately to everyone. Add `\"version\": \"0.1.0\"` and bump it deliberately.",
    );
  } else if (typeof json.version !== "string" || !SEMVER_RE.test(json.version)) {
    at("error", `plugin.json \`version: ${String(json.version)}\` is not valid semver (expected e.g. 1.2.3)`);
  }
  return findings;
}

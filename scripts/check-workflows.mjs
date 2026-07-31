#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflowDir = join(root, ".github", "workflows");
const issueTemplateDir = join(root, ".github", "ISSUE_TEMPLATE");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const packageVersion = packageJson.version;
const files = [
  join(root, "action.yml"),
  ...readdirSync(workflowDir)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => join(workflowDir, name)),
];
const actionReference = /^([\w.-]+\/[\w.-]+(?:\/[\w.-]+)*)@([0-9a-f]{40})(?:\s+#\s+v\d+(?:\.\d+\.\d+)?)?$/;
const repositoryLabels = new Set(["bug", "enhancement", "dependencies"]);
const githubConfigFiles = [
  join(root, ".github", "dependabot.yml"),
  join(issueTemplateDir, "config.yml"),
  ...readdirSync(issueTemplateDir)
    .filter((name) => name !== "config.yml" && /\.ya?ml$/.test(name))
    .sort()
    .map((name) => join(issueTemplateDir, name)),
];

let failures = 0;
if (packageJson.bin?.skillcheck !== "dist/bin.js") {
  console.error('  ✖ package.json\n      bin.skillcheck must be "dist/bin.js" so npm preserves the CLI');
  failures++;
}

for (const file of files) {
  const label = relative(root, file);
  try {
    const document = YAML.parseDocument(readFileSync(file, "utf8"), { uniqueKeys: true });
    if (document.errors.length > 0) throw document.errors[0];

    const value = document.toJS();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("top level must be a mapping");
    }
    if (label === "action.yml" && !value.runs) {
      throw new Error("action.yml is missing `runs`");
    }
    if (label === "action.yml" && value.inputs?.version?.default !== packageVersion) {
      throw new Error(
        `action.yml version default ${JSON.stringify(value.inputs?.version?.default)} does not match package.json ${packageVersion}`,
      );
    }
    if (label !== "action.yml" && (!("on" in value) || !value.jobs)) {
      throw new Error("workflow is missing `on` or `jobs`");
    }

    for (const line of readFileSync(file, "utf8").split("\n")) {
      const reference = line.match(/^\s*uses:\s*(.+)$/)?.[1];
      if (reference && !reference.startsWith("./") && !actionReference.test(reference)) {
        throw new Error(`action reference must use a full commit SHA: ${reference}`);
      }
    }

    console.log(`  ✔ ${label}`);
  } catch (error) {
    console.error(`  ✖ ${label}\n      ${error.message}`);
    failures++;
  }
}

for (const file of githubConfigFiles) {
  const label = relative(root, file);
  try {
    const document = YAML.parseDocument(readFileSync(file, "utf8"), { uniqueKeys: true });
    if (document.errors.length > 0) throw document.errors[0];
    const value = document.toJS();

    if (label === ".github/dependabot.yml") {
      if (value?.version !== 2 || !Array.isArray(value.updates) || value.updates.length === 0) {
        throw new Error("Dependabot config needs version 2 and at least one update ecosystem");
      }
      for (const update of value.updates) {
        for (const name of update.labels ?? []) {
          if (!repositoryLabels.has(name)) throw new Error(`Dependabot references missing label ${name}`);
        }
      }
    } else if (label.endsWith("/config.yml")) {
      if (value?.blank_issues_enabled !== false || !Array.isArray(value.contact_links)) {
        throw new Error("issue chooser must disable blank issues and provide contact links");
      }
    } else {
      if (!value?.name || !value.description || !Array.isArray(value.body) || value.body.length === 0) {
        throw new Error("issue form needs name, description and a non-empty body");
      }
      const ids = value.body.map((item) => item.id).filter(Boolean);
      if (new Set(ids).size !== ids.length) throw new Error("issue form field ids must be unique");
      for (const name of value.labels ?? []) {
        if (!repositoryLabels.has(name)) throw new Error(`issue form references missing label ${name}`);
      }
    }

    console.log(`  ✔ ${label}`);
  } catch (error) {
    console.error(`  ✖ ${label}\n      ${error.message}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} GitHub configuration error(s)`);
  process.exit(1);
}
console.log(`\n${files.length + githubConfigFiles.length} GitHub YAML files parse cleanly`);

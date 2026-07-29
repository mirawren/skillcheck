#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflowDir = join(root, ".github", "workflows");
const packageVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const files = [
  join(root, "action.yml"),
  ...readdirSync(workflowDir)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => join(workflowDir, name)),
];

let failures = 0;
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

    console.log(`  ✔ ${label}`);
  } catch (error) {
    console.error(`  ✖ ${label}\n      ${error.message}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} GitHub YAML file(s) are invalid`);
  process.exit(1);
}
console.log(`\n${files.length} GitHub YAML files parse cleanly`);

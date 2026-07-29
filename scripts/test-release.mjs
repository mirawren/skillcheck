#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = YAML.parse(readFileSync(join(root, ".github", "workflows", "release.yml"), "utf8"));
const moveStep = workflow.jobs["release-github"].steps.find((step) =>
  step.name?.startsWith("Move the major tag"),
);
if (!moveStep?.run) throw new Error("release workflow has no major-tag movement step");

const work = mkdtempSync(join(tmpdir(), "skillcheck-release-"));
const remote = join(work, "remote.git");
const seed = join(work, "seed");
const checkout = join(work, "checkout");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

try {
  execFileSync("git", ["init", "--bare", "--quiet", remote]);
  execFileSync("git", ["init", "--quiet", seed]);
  git(seed, "config", "user.name", "release verifier");
  git(seed, "config", "user.email", "release-verifier@example.com");
  git(seed, "commit", "--allow-empty", "--quiet", "-m", "v1.0.0");
  git(seed, "tag", "v1.0.0");
  git(seed, "commit", "--allow-empty", "--quiet", "-m", "v1.0.1");
  git(seed, "tag", "v1.0.1");
  git(seed, "branch", "-M", "main");
  git(seed, "remote", "add", "origin", remote);
  git(seed, "push", "--quiet", "origin", "main", "--tags");
  git(remote, "symbolic-ref", "HEAD", "refs/heads/main");
  execFileSync("git", ["clone", "--quiet", remote, checkout]);

  const runRelease = (tag) =>
    execFileSync("bash", ["-c", moveStep.run], {
      cwd: checkout,
      env: { ...process.env, GITHUB_REF_NAME: tag },
      encoding: "utf8",
    });
  const remoteTag = (tag) =>
    git(checkout, "ls-remote", "--tags", "origin", `refs/tags/${tag}`).split(/\s+/)[0];

  runRelease("v1.0.1");
  assert.equal(remoteTag("v1"), remoteTag("v1.0.1"), "v1 should point at the first released tag");

  runRelease("v1.0.0");
  assert.equal(remoteTag("v1"), remoteTag("v1.0.1"), "an older release must not move v1 backward");

  // Simulate a faster concurrent release after this checkout became stale:
  // publish both the new exact tag and its v1 movement from the seed clone.
  git(seed, "commit", "--allow-empty", "--quiet", "-m", "v1.0.2");
  git(seed, "tag", "v1.0.2");
  git(seed, "tag", "--force", "v1", "v1.0.2");
  git(seed, "push", "--quiet", "origin", "main", "refs/tags/v1.0.2");
  git(seed, "push", "--quiet", "--force", "origin", "refs/tags/v1");

  runRelease("v1.0.1");
  assert.equal(
    remoteTag("v1"),
    remoteTag("v1.0.2"),
    "a stale older release must not roll back a concurrently advanced v1",
  );

  console.log("release major tag advances monotonically and resists stale-runner rollback");
} finally {
  rmSync(work, { recursive: true, force: true });
}

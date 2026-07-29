import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CliIO } from "../src/cli";

const roots: string[] = [];

/**
 * Build a throwaway repo from a `{ "skills/foo/SKILL.md": "..." }` map and
 * return its absolute root. Registered for {@link cleanupTmpRepos}.
 */
export function tmpRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "skillcheck-test-"));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return root;
}

export function cleanupTmpRepos(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

/** A SKILL.md with sane defaults, so each test only states what it's testing. */
export function skillMd(
  name: string,
  description: string,
  body = "Collect the inputs, apply the template, and report what changed.",
): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${body}\n`;
}

export interface CapturedIo {
  io: CliIO;
  out(): string;
  err(): string;
  all(): string;
}

/** Capture everything the CLI writes instead of letting it reach the terminal. */
export function captureIo(env: NodeJS.ProcessEnv = {}): CapturedIo {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (text) => void out.push(text), err: (text) => void err.push(text), env },
    out: () => out.join(""),
    err: () => err.join(""),
    all: () => out.join("") + err.join(""),
  };
}

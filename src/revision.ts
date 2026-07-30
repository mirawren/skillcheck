import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDiscoverableSkillPath } from "./discover.js";
import { parseSkillText } from "./parse.js";
import type { SkillDoc } from "./types.js";

/**
 * Reading a skill corpus as it was at another revision.
 *
 * Every other check in skillcheck answers a question about one snapshot of a
 * repo. The question a pull request actually raises is comparative — *did this
 * change which skill wins?* — and answering it needs the corpus twice: once as
 * it is, once as it was.
 *
 * Git is the only place the "as it was" copy exists, so this module reads it
 * through git plumbing rather than the filesystem. Three properties are worth
 * stating outright, because they are what keep the offline guarantee intact:
 *
 *   - **No network.** `ls-tree` and `cat-file` read the local object database.
 *     A ref that isn't fetched yet is a clear error, never a fetch.
 *   - **No mutation.** Nothing is checked out, stashed, or written. A run cannot
 *     disturb a working tree, which matters because this runs in CI next to
 *     whatever else the job is doing.
 *   - **One process for the content.** `cat-file --batch` streams every blob
 *     through a single pipe. Spawning one `git show` per skill is fine at five
 *     skills and takes tens of seconds across a marketplace of three thousand.
 */

/** Thrown when a revision can't be read; the CLI maps this to exit code 2. */
export class RevisionError extends Error {}

/** A git invocation's captured result, buffered so blob content survives. */
interface GitResult {
  status: number;
  stdout: Buffer;
  stderr: string;
}

/**
 * Blobs can be large and there are as many as there are skills, so the pipe
 * ceiling has to hold an entire marketplace's worth of `SKILL.md` at once.
 * 256 MiB is far past any real corpus and still a bounded failure instead of an
 * unbounded allocation.
 */
const MAX_GIT_OUTPUT = 256 * 1024 * 1024;

function git(cwd: string, args: string[], input?: string): GitResult {
  const result = spawnSync("git", args, {
    cwd,
    input,
    maxBuffer: MAX_GIT_OUTPUT,
    windowsHide: true,
  });
  if (result.error) {
    const err = result.error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new RevisionError(
        "comparing against a revision needs `git` on PATH, and it isn't there",
      );
    }
    throw new RevisionError(`git ${args[0]} failed: ${err.message}`);
  }
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: (result.stderr ?? Buffer.alloc(0)).toString("utf8").trim(),
  };
}

/** Absolute path of the repository root containing `from`. */
export function repoRoot(from: string = process.cwd()): string {
  const result = git(from, ["rev-parse", "--show-toplevel"]);
  if (result.status !== 0) {
    throw new RevisionError(
      `${from} is not inside a git repository, so there is no revision to compare against`,
    );
  }
  return realpathSync.native(resolve(result.stdout.toString("utf8").trim()));
}

/**
 * Resolve `ref` to a commit, or explain why it can't be.
 *
 * The failure worth spelling out is a CI one: a shallow clone (the default for
 * `actions/checkout`) has the branch tip and nothing else, so `main` genuinely
 * does not exist locally even though it obviously exists. That reads as a
 * skillcheck bug unless the message says otherwise.
 */
export function resolveRef(root: string, ref: string): string {
  const result = git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  const oid = result.stdout.toString("utf8").trim();
  if (result.status !== 0 || !oid) {
    throw new RevisionError(
      `no revision named \`${ref}\` in this repository. ` +
        "In CI, a shallow clone has only the branch it checked out — " +
        "fetch the base first (actions/checkout with `fetch-depth: 0`).",
    );
  }
  return oid;
}

/** A `SKILL.md` as it existed at one revision, keyed by its working-tree path. */
interface RevisionBlob {
  /** Absolute path the file has in the working tree. */
  file: string;
  /** Git object id of its content at that revision. */
  oid: string;
}

/**
 * Every `SKILL.md` under `roots` at `ref`.
 *
 * Paths are returned as the absolute working-tree paths they *would* have, not
 * as git's repo-relative ones. That is what makes the two corpora comparable:
 * a skill is the same skill across revisions because it sits at the same path,
 * and every message about it should name the path a reader can open.
 */
function listSkills(root: string, ref: string, roots: readonly string[]): RevisionBlob[] {
  const pathspecs = roots.map((r) => repoRelative(root, r));
  // `-z` because a path may contain anything at all, including a newline, and
  // `ls-tree`'s default output would quote it into something unparseable.
  const result = git(root, ["ls-tree", "-r", "-z", ref, "--", ...pathspecs]);
  if (result.status !== 0) {
    throw new RevisionError(`could not list files at \`${ref}\`: ${result.stderr || "git failed"}`);
  }

  const blobs: RevisionBlob[] = [];
  for (const entry of result.stdout.toString("utf8").split("\0")) {
    if (!entry) continue;
    // `<mode> SP <type> SP <oid> TAB <path>`
    const tab = entry.indexOf("\t");
    if (tab === -1) continue;
    const meta = entry.slice(0, tab).split(" ");
    const path = entry.slice(tab + 1);
    // The same predicate the filesystem walk uses, so the two sides of the
    // comparison agree about what a skill is. See isDiscoverableSkillPath.
    if (meta[1] !== "blob" || !isDiscoverableSkillPath(path)) continue;
    blobs.push({ file: join(root, ...path.split("/")), oid: meta[2] });
  }
  // Same order the filesystem walk produces, so the two corpora index alike.
  return blobs.sort((a, b) => a.file.localeCompare(b.file));
}

/** `path` expressed relative to the repo root, as a git pathspec. */
function repoRelative(root: string, path: string, allowMissing = false): string {
  const abs = isAbsolute(path) ? resolve(path) : resolve(process.cwd(), path);
  // Git and Node can spell the same Windows path differently (notably a long
  // user profile versus its 8.3 alias). Compare the paths the filesystem says
  // they are, not those two textual spellings.
  const target = allowMissing ? realpathWithMissingTail(abs) : realpathSync.native(abs);
  const rel = relative(realpathSync.native(root), target);
  if (!rel) return ".";
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new RevisionError(
      `${path} is outside the git repository at ${root}, so it has no history to compare against`,
    );
  }
  return rel.split(sep).join("/");
}

/**
 * Canonicalize the existing part of a path while preserving a missing tail.
 *
 * Historical files routinely do not exist in the working tree: a scenario file
 * may have been renamed or deleted in the change being compared. Resolving only
 * lexically would mishandle a symlinked parent; requiring the leaf to exist
 * makes that history unreadable. Walking upward gives us both containment and a
 * usable git pathspec.
 */
function realpathWithMissingTail(path: string): string {
  let cursor = resolve(path);
  const tail: string[] = [];
  while (true) {
    try {
      return resolve(realpathSync.native(cursor), ...tail.reverse());
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw err;
      const parent = dirname(cursor);
      if (parent === cursor) throw err;
      tail.push(basename(cursor));
      cursor = parent;
    }
  }
}

/**
 * Read many blobs in one `git cat-file --batch`.
 *
 * The protocol is line-oriented on the way in and byte-counted on the way out:
 * for each requested id, git writes `<oid> SP <type> SP <size> LF`, then exactly
 * `size` bytes, then a `LF`. Sizes are bytes, not characters, so the response
 * has to be walked as a Buffer — decoding first would desynchronize the parser
 * on the first multi-byte character, which in this project's subject matter is
 * every non-English skill.
 */
function readBlobs(root: string, oids: readonly string[]): Map<string, string> {
  const contents = new Map<string, string>();
  if (oids.length === 0) return contents;

  const result = git(root, ["cat-file", "--batch"], `${oids.join("\n")}\n`);
  if (result.status !== 0) {
    throw new RevisionError(`could not read file contents: ${result.stderr || "git failed"}`);
  }

  const out = result.stdout;
  let at = 0;
  while (at < out.length) {
    const eol = out.indexOf(0x0a, at);
    if (eol === -1) break;
    const header = out.toString("utf8", at, eol).split(" ");
    at = eol + 1;
    // `<oid> missing` — a blob we just listed is gone. Skip it rather than
    // failing the run: the corpus is still comparable without it.
    const size = Number(header[2]);
    if (header[1] !== "blob" || !Number.isFinite(size)) continue;
    contents.set(header[0], out.toString("utf8", at, at + size));
    at += size + 1; // content, then the trailing newline git adds
  }
  return contents;
}

/**
 * One file's text at `ref`, or null when it wasn't there.
 *
 * Used for the scenarios file, whose *contents at the base revision* decide
 * which assertions this change could have regressed. A prompt written in the
 * same pull request has no prior answer, and ranking it against the old corpus
 * manufactures one — see {@link readSkillsAtRef}'s caller.
 */
export function readFileAtRef(
  ref: string,
  path: string,
  cwd: string = process.cwd(),
): string | null {
  const root = repoRoot(cwd);
  const commit = resolveRef(root, ref);
  const spec = repoRelative(root, path, true);
  const result = git(root, ["cat-file", "-e", `${commit}:${spec}`]);
  if (result.status !== 0) return null;
  const blob = git(root, ["cat-file", "blob", `${commit}:${spec}`]);
  return blob.status === 0 ? blob.stdout.toString("utf8") : null;
}

/**
 * Parse every skill under `roots` as it existed at `ref`.
 *
 * The returned docs are ordinary {@link SkillDoc}s — indexable, rankable, and
 * checkable by every rule — so nothing downstream needs to know that this
 * corpus came out of git rather than off the disk.
 */
export function readSkillsAtRef(
  ref: string,
  roots: readonly string[],
  cwd: string = process.cwd(),
): SkillDoc[] {
  const root = repoRoot(cwd);
  const commit = resolveRef(root, ref);
  const blobs = listSkills(root, commit, roots.length ? roots : ["."]);
  const contents = readBlobs(root, [...new Set(blobs.map((b) => b.oid))]);

  const docs: SkillDoc[] = [];
  for (const blob of blobs) {
    const raw = contents.get(blob.oid);
    if (raw === undefined) continue;
    docs.push(parseSkillText(blob.file, raw));
  }
  return docs;
}

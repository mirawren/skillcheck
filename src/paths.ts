import { homedir } from "node:os";
import { isAbsolute, relative, sep } from "node:path";

/**
 * How a file path is spelled depends entirely on who reads it, and getting the
 * two confused is how a linter ends up either unreadable or unclickable.
 */

/**
 * Repo-relative POSIX path — the *interchange* spelling.
 *
 * SARIF's `artifactLocation.uri` and GitHub's `::error file=` workflow command
 * both require a path relative to the workspace root; an absolute one silently
 * fails to attach to any line in the diff. Never use this for something a
 * person reads — see {@link displayPath}.
 */
export function toPosix(file: string, cwd: string = process.cwd()): string {
  return relative(cwd, file).split(sep).join("/");
}

/**
 * The spelling a human should read.
 *
 * `relative()` alone is fine inside the working tree and unreadable outside it
 * — linting an installed marketplace prints a dozen `../` segments before the
 * part that actually identifies the skill. So: relative while the path stays
 * inside the tree, absolute once it escapes, with `$HOME` abbreviated to `~`
 * where that's the local idiom.
 */
export function displayPath(file: string, cwd: string = process.cwd()): string {
  const rel = relative(cwd, file);
  // `relative` escapes the tree with `..`, and on Windows returns an absolute
  // path outright when the two paths sit on different drives.
  if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) {
    return rel.split(sep).join("/");
  }
  const posix = file.split(sep).join("/");
  if (process.platform === "win32") return posix;
  const home = homedir().split(sep).join("/").replace(/\/+$/, "");
  return home && posix.startsWith(`${home}/`) ? `~${posix.slice(home.length)}` : posix;
}

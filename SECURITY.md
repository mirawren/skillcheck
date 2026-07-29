# Security policy

## What skillcheck does with your files

It reads them. That's the whole threat model, and it's deliberate:

- **No network access.** skillcheck never makes an HTTP request, at any point, in any mode. There is no telemetry, no update check, no model call.
- **No credentials.** It has nothing to authenticate to.
- **No code execution.** It parses YAML and Markdown as data. It never runs a script it finds in a skill, and never evaluates anything from a `SKILL.md`.
- **Writes only where asked.** `--fix` rewrites the `SKILL.md` files you pointed it at; `init` writes its scaffold; `--update-baseline` writes the baseline file. Nothing else is ever written.
- **Two runtime dependencies** (`yaml`, `picocolors`), no postinstall scripts.

That means it is safe to run on untrusted repositories, which is the point — a CI check you can't run on a fork's pull request isn't a CI check.

**What it is not:** a security scanner. skillcheck tells you whether *your own* skills work. It does not detect prompt injection, malicious instructions, or supply-chain tampering in skills you install from elsewhere. Use a dedicated agent-security scanner for that; the two are complementary.

## Reporting a vulnerability

Report privately through GitHub's [security advisory form](https://github.com/mirawren/skillcheck/security/advisories/new) rather than a public issue.

Please include a reproduction — for this project that usually means the input file that causes the problem. Expect an acknowledgement within 3 days and an assessment within 7.

Things worth reporting:

- Any path by which skillcheck executes code, opens a socket, or writes outside the paths it was given.
- A crafted `SKILL.md`, `plugin.json`, config, baseline, or scenarios file that causes a crash, a hang, or unbounded memory use (it is expected to run on untrusted input).
- A path-traversal in `--fix` or `init` that writes outside the target directory.

## Supported versions

Starting with 1.0.0, the latest published minor version receives fixes. Releases are published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements), so you can verify that a tarball came from this repository's release workflow.

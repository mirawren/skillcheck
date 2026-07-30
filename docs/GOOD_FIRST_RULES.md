# Good first rules

Every entry below is a real skill failure mode that skillcheck doesn't catch yet. Each is scoped to **one small PR** — a rule file, a test, and a line in `src/rules/index.ts`. [CONTRIBUTING.md](../CONTRIBUTING.md) has the 15-minute walkthrough.

Claim one by opening an issue (or commenting on the tracking issue) so two people don't write the same rule. If you disagree with a proposal — including whether it should exist at all — say so; a rejected rule with a good reason is a useful contribution.

The bar for every one of these: **a false positive is worse than a miss.**

## Frontmatter and loading

| Rule | Catches | Notes |
| --- | --- | --- |
| `duplicate-skill-name` | Two skills declaring the same `name` in one repo | Which one loads is host-dependent; error. Cross-skill rule — see `description-similarity` for the pattern. |
| `allowed-tools-valid` | `allowed-tools` that isn't a list, or names a tool no host has | Keep the allowlist permissive — hosts differ. Warning. |
| `license-spdx` | A `license` value that isn't a valid SPDX identifier | Only when the field is present. Warning. |
| `version-semver` | A skill `version` that isn't semver | Mirror the plugin-manifest check. |
| `metadata-key-format` | `metadata` keys that hosts reject (spaces, uppercase) | Verify against the spec before writing it. |
| `frontmatter-order` | *Probably not a rule.* Ordering is cosmetic — included as an example of what gets rejected. | — |

## Triggering

| Rule | Catches | Notes |
| --- | --- | --- |
| `description-truncated` | A description ending mid-sentence — the tell-tale of a truncated paste | The trigger clause usually lives at the end, so this loses exactly the part that matters. |
| `description-duplicates-body` | The description repeated verbatim as the body's first paragraph | Wasted tokens on every activation. Warning. |
| `description-no-verb` | Descriptions with no action word at all ("PDF stuff") | Needs care to avoid false positives; warning at most. |
| `trigger-overlap-with-builtin` | A description that collides with a host's built-in behaviour | Research first — needs a defensible list. |

## Body quality

| Rule | Catches | Notes |
| --- | --- | --- |
| `empty-headings` | A heading with no content under it | The model reads it as a section it should fill in. |
| `absolute-home-paths` | `~/` or `/Users/…` paths in the body | Works on the author's machine only. |
| `windows-path-separators` | `refs\thing.md` in links | Breaks on every non-Windows host. |
| `link-case-mismatch` | `References/x.md` when the file is `references/x.md` | Passes on macOS, fails on Linux CI. Extend `broken-references`. |
| `script-not-executable` | A referenced `scripts/x.sh` that exists but isn't executable | Filesystem check; careful on Windows. |
| `code-fence-unclosed` | An unterminated code fence | Everything after it is read as code. |

## Repo shape

| Rule | Catches | Notes |
| --- | --- | --- |
| `skill-nesting-depth` | `SKILL.md` buried deeper than hosts discover | Confirm the actual limit per host first. |
| `orphaned-references` | Files in the skill folder that nothing links to | Warning — the inverse of `broken-references`. |
| `agents-md-contradiction` | A skill instructing the opposite of `AGENTS.md` | Hard; start with an exact-negation heuristic and keep it a warning. The context document type it needs already exists — see `src/context.ts`. |
| `context-duplicate-instruction` | The same instruction in both `AGENTS.md` and `CLAUDE.md` | Both get loaded, so it is paid twice. Warning; needs care about near-duplicates. |

## Tooling

| Improvement | Why |
| --- | --- |
| `--tokens=api` | Exact token counts instead of the script-aware estimate, opt-in and offline-optional |
| Config file in YAML/TOML | JSON has no comments, and rule config wants explaining |
| `skillcheck why --all` | Run every scenario and print the full trigger matrix |
| Watch mode | `skillcheck --watch` while authoring |

## Bigger pieces (talk first)

These are worth doing but need a design conversation before code:

- **`skillcheck eval`** — model-in-the-loop trigger testing: run a scenario through a real headless agent and assert the skill fired. Opt-in, credentialed, cached. The complement to the offline simulation in `skillcheck test`.
- **Cross-host parity matrix** — which frontmatter each host actually reads, checked in and kept current.
- **VS Code extension** — the findings as you type.

# Changelog

Notable changes. This project follows [semantic versioning](https://semver.org/).

## 0.3.0 — unreleased

The release that answers the question the project is named after: **would this request actually reach this skill?**

### Trigger simulation

- **`skillcheck why "<request>"`** — ranks every skill against a request, shows which words produced the match, and names the verdict: a clear winner, a coin flip, or nothing at all. Deterministic BM25 over each skill's name and description; no model, no network.
- **`skillcheck test`** — trigger scenarios as a checked-in file (`skillcheck.scenarios.yaml`): each request plus what should happen to it. Exits non-zero when one regresses, so "my skill stopped firing" becomes a failed build instead of a support thread. A scenario that only just passes is reported as *too close to call* rather than green.
- **`forbid:` assertions** — *whatever wins, it must not be this one*. The assertion that scales past a handful of skills, where pinning an exact winner over-specifies and breaks on unrelated edits, and the right shape when being wrong is expensive: you don't need to know which skill handles a request to know which one must not. A forbidden skill that merely trails the winner by a hair is reported too.
- **`expect:` accepts a list** — `expect: [csv-tidy, json-tidy]` when two skills genuinely overlap and what you care about is that a third one doesn't take the request.
- **The scenarios file is versioned.** It lives in *your* repo, so its shape is a contract: `version:` is declared, absent means 1, and a file from a newer skillcheck is refused with an upgrade hint rather than parsed on a best-effort basis — a skipped assertion is worse than a failed run. Unknown keys are rejected for the same reason: `expct:` costs you a build instead of silently testing nothing. Files written before `version` existed keep working unchanged. Full reference: [docs/scenarios.md](docs/scenarios.md).
- **A name that doesn't exist fails its scenario**, including in `forbid`, where it's least obvious — "must not fire" is trivially true of a deleted skill, so the guard would evaporate silently.
- **New rule `trigger-shadowing`** — finds skills whose defining vocabulary is already fully covered by a broader sibling. That skill is installed, valid, and unreachable; nothing in a per-file lint can see it.

### Skills that aren't in English

- **The tokenizer no longer deletes most of the world's writing.** It split on `[^a-z0-9]+`, so a Japanese description became two loanwords and a Russian one became nothing — and every downstream check then reasoned about that empty set and reported confident nonsense. Segmentation is now driven by Unicode script (`src/script.ts`): script changes end a word, scripts written without spaces fall back to character bigrams, and folding strips marks only where they're decoration and never where they're vowels.
- **24 language packs** — stopwords, "use this when…" phrasings for `when-to-use`, and assistant-voice patterns for `description-third-person`, each pack a single self-contained data file. A language with no pack is never reported on rather than guessed about.
- **New rule `cross-language-trigger`** — in a repo whose skills span several languages, a skill described only in Japanese isn't outranked by an English request, it's *unreachable* by one: there's no term in common to rank on. It installs, validates, and never fires for half the team. Only fires in a repo that is already multilingual, and only where the gap can be total.
- **`skillcheck languages`** — the language split of your repo, which skills landed in each, and which were detected on thin evidence and should declare `x-skillcheck.lang`.
- **`skillcheck why` names the languages that were never in the running**, so an empty ranking in a multilingual repo reads as "asked in the wrong language" rather than "no skill covers this".
- **Terminal output lines up outside ASCII.** Padding counted UTF-16 code units, so tables came apart at exactly the CJK and Brahmic labels that demonstrate the feature works. Width is now measured in columns, with East Asian Wide counted double and nonspacing marks counted zero.
- **`tests/languages.test.ts` enforces the pack contract**, which `types.ts` had promised and nothing delivered: every pack's worked examples must be detected as that language, the ones stating a trigger must pass `when-to-use`, and the ones stating only a capability must still be reported. Writing it immediately surfaced four shipped bugs — two dead Arabic stopwords that folding could never produce, duplicate entries in Arabic and Japanese, three regexes anchored with `\b` where JavaScript can never fire it, and a Hindi pattern that read "a collection of utilities for…" as "use for…", which had switched the flagship rule off for the language.

### Making it adoptable

- **`skillcheck init`** — writes the CI workflow, a starter scenarios file seeded from your own skills (so the first `skillcheck test` passes), the badge snippet, and the devDependency. **Re-running it is part of the contract**: a later run appends scenarios for skills added since, leaves everything already there untouched, and treats a `forbid` as covering a skill so it never contradicts an assertion you wrote. It declines rather than writing when appending would alter or invalidate the file — a scaffolder that eats hand-written trigger tests once is a scaffolder nobody runs twice.
- **`--fix` / `--fix-dry-run`** — autofix for the safe, mechanical findings: invalid `name` casing, typo'd frontmatter keys, curly quotes. Multi-pass, idempotent, and deliberately conservative — it won't rename your folders or overwrite a real field with a typo'd one.
- **Baselines** — `--update-baseline` records what's already broken so CI fails only on *new* findings. An established repo can adopt skillcheck today instead of "after we clean everything up". The score deliberately keeps counting baselined findings: a baseline decides what fails CI, never what the badge claims.
- **`skillcheck explain <rule>`** — the reasoning and a before/after example for any rule, in the terminal.

### Output

- **Skill health score** (0–100, A–F) in every format, plus `--format badge` for a shields.io endpoint badge.
- **`--format markdown`** and `--summary`, which writes the report to the GitHub job summary.
- The Action now sets **outputs** (`score`, `grade`, `errors`, `warnings`, `skills`) and can run trigger scenarios.
- SARIF now carries per-rule `help` text, so GitHub's Security tab shows the fix guidance next to the finding.

### Rules

- Added `body-not-empty`, `no-placeholders`, `smart-quotes` (fixable), `description-third-person`, `trigger-shadowing`, `cross-language-trigger` — 15 checks in total.
- Every rule now carries its own documentation, and [docs/rules.md](docs/rules.md) is generated from it. CI fails if the two disagree, so the reference can't go stale.

### Fixes and performance

- **`description-similarity` no longer reports every colliding pair.** On a corpus of 1,000 near-identical skills that was 499,500 findings — a report nobody can read. Each skill now names its worst collision and counts the rest.
- **Rules set to `"off"` are no longer executed**, only filtered afterwards. Disabling a rule now actually saves the work.
- Cross-skill checks moved onto a shared inverted index: **~8× faster** on a 3,000-skill corpus (4.9s → 0.6s), and roughly 5,000 skills/second at 1,000-skill scale.
- Windows and macOS added to CI. The published tarball is installed and run as part of every build.
- **The Action aborted on macOS runners.** With no optional inputs set, `"${args[@]}"` on an empty array under `set -u` is an "unbound variable" error in bash 3.2 — which is what macOS ships — so the step died before skillcheck started. The default `summary: true` masked it by keeping the array non-empty, leaving it to surface on `summary: false` and on every `test` step. `action.yml` is now executed and its argv asserted in CI, on bash 3.2, by `npm run test:action`.
- **The Action's `config` input now reaches the scenarios step**, which decides which skills are in scope — scenarios were resolving against a different set of skills than the lint step saw.
- **`npm run set-owner` no longer rewrites test fixtures.** It was substituting a placeholder URL that tests assert *on*, inverting them — and since `prepublishOnly` runs the suite, the breakage landed mid-publish, after the owner had already been substituted.
- Paths outside the working tree are printed as `~/…` rather than a dozen `../` segments — linting an installed marketplace was unreadable.

### Breaking

- The binary moved from `dist/cli.js` to `dist/bin.js` (`package.json` `bin` handles this; nothing changes for `npx skillcheck` users). `src/cli.ts` now exports `runCli(argv, io)` returning an exit code, so the CLI is testable in-process.
- `fixFiles(files, …)` is now `fixDocs(docs, rulesFor, ctx)` — pure over already-parsed docs, with per-doc rule selection so `x-skillcheck` opt-outs apply to autofix too.
- `Rule` now requires a `docs` field.

## 0.2.0

- `skillcheck.config.json`: per-rule `off`/`warn`/`error`, per-rule option thresholds, `ignore` globs.
- Per-skill suppression via `x-skillcheck: { disable: [...] }` in frontmatter.
- `--format sarif` for GitHub code scanning.

## 0.1.0

- First release: 8 rules for `SKILL.md`, plugin-manifest checks, pretty/json/github output, and the GitHub Action.

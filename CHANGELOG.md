# Changelog

Notable changes. This project follows [semantic versioning](https://semver.org/).

## Unreleased

### Project presentation and GitHub operations

- Added a dependency-free project website, an original 1280 × 640 social card, and a GitHub Pages
  deployment workflow. The README now leads with the same visual identity and links directly to
  the short adoption path.
- Replaced free-form issue templates with validated issue forms that use labels already present in
  the repository, added a support guide, and made the issue chooser route security reports to the
  private advisory channel.
- Added CodeQL scanning, immutable commit pins for third-party Actions, workflow concurrency and
  timeouts, and automated checks for the site, issue forms, Dependabot config, and Action pins.

### `AGENTS.md` and `CLAUDE.md` are checked

- **A new document kind.** A skill's body is opt-in — it costs nothing until the model picks it. A context file is not: it is read before the user's first word and carried by every request in the session. Nothing checked those files, and they fail the same quiet way a skill does. `skillcheck .` now discovers `AGENTS.md` and `CLAUDE.md` at each scanned root and below it, applies `ignore` globs to them, scores them as units, and counts them in every output format. A repo with no skills at all is no longer an empty scan.
- **`broken-references` and `no-placeholders` reuse their rule ids** rather than gaining context-file twins. It is the same defect with the same fix, and switching a rule off has to switch off all of it. The reference scan additionally reads `@path` imports, whose target is dropped in silence when it does not exist — the session proceeds exactly as if those instructions had arrived. The finding says `imports` rather than `links to`, because that distinction is most of knowing what the absence broke.
- **The `@` heuristic is narrow on purpose.** This rule reports at error severity, so a token counts as an import only when it holds a `/`, ends in a file extension, and starts at a word boundary. npm scopes (`@types/node`), email addresses, bare handles, home-relative paths, URLs containing an `@`, fenced blocks and inline code spans are all left alone, and each is a regression test.
- **`context-size`** is new, and warns at 250 lines / ~2,500 estimated tokens — half the Agent Skills body budget, because the cost is paid unconditionally rather than on activation. Both numbers are configurable. The detail line distinguishes a root file, paid in every session, from a nested one paid only while the agent works in that directory.
- **`skillcheck budget`** reports what a repo's instructions occupy before anyone asks for anything: every skill *description* plus every root context file on one side, each skill *body* on the other. The model cannot choose between skills without being shown all of them, so descriptions are always in context — the cost of *keeping* a skill, as against the cost of *using* one — and no per-file view separates those. The per-skill table carries both numbers and sorts on the always-on one, since `body-size` already budgets a body and nothing else names the description taxing every request. It is a report, not a gate: it always exits 0, because no threshold for "too much context" means the same thing in a two-skill repo and in a marketplace. `--format json` carries every line.
- Library: `Summary` gains `contexts`, `CheckResult.files` gains an optional `contexts`, and `evaluate()` takes context documents as a fourth argument. `computeScore` tolerates a `CheckResult` built before this release rather than throwing on the missing field.

### Somewhere that isn't GitHub

- **`--format junit`** for the default check and for `skillcheck test`. Rich reporting was GitHub-only — SARIF for code scanning, workflow commands for annotations, a job summary — so on GitLab, Jenkins, CircleCI, Buildkite or Azure Pipelines the findings were a wall of log text. A scanned unit is a suite, a finding is a failing case, and a unit with no findings is a passing one, so the run shows a repo's real coverage rather than only what broke. Two findings from one rule in one file are named apart by line, because a consumer keys history on `(classname, name)` and would otherwise drop the second.
- **`diff` refuses `junit`**, and the Action falls back to GitHub output rather than failing the job on it. A JUnit consumer keys history on the case name, and a drift probe is named after text that existed at two particular revisions — the accumulated history would be about cases that never recur. A scenario prompt is stable, which is why `test` accepts it.
- **`.pre-commit-hooks.yaml`** ships in the package, so skillcheck installs as a [pre-commit](https://pre-commit.com) hook — `skillcheck` for the lint, `skillcheck-test` for the trigger scenarios. Both run over the whole repository rather than the staged files: two rules compare skills against each other, and a per-file run would report a collision on whichever half of the pair was staged.

### Everything else

- `skillcheck diff` now evaluates stable scenario assertions on both revisions instead of treating every winner change as a regression. Repairs and clear movement between allowed winners stay green; `expect`, `forbid`, and `expect: none` regressions fail. Passing contracts that become too close to depend on are reported as narrowing even when the winner also moves to another allowed skill. Multiple contracts may share one prompt, and every assertion is evaluated.
- Added, edited, and removed scenario contracts are named as not compared instead of disappearing. The version 2 drift JSON envelope exposes them under `scenarioContracts.skipped` and includes a normalized `contract` on every scenario drift, so same-prompt assertions remain distinguishable to bots. Auto-discovery follows `.yaml`/`.yml` renames with canonical priority; an explicit `--scenarios` path remains exact.
- `skillcheck test` now reports which distinct skill names appear in a direct `expect` or `forbid` assertion. Its GitHub output annotates failed and close contracts, names up to 20 unasserted skills and counts the rest, `--summary` writes a Markdown scenario table, and JSON output exposes the complete asserted and unasserted lists.
- The default check now exits 2 when its paths and ignore patterns discover no skills or plugin manifests, instead of reporting `100/100 (A)` for checking nothing. Plugin-only repositories remain valid.
- Malformed percent escapes in Markdown links are now checked as literal paths instead of crashing; a missing literal target produces the ordinary `broken-references` finding. Scenario comparison changes are represented structurally in machine output, so `skillcheck diff --format json` stays parseable without hiding skipped contracts.
- The Action now runs trigger and drift reporting after an earlier check fails, unless the job was cancelled. Its diff step honors the requested trigger/diff output format and `summary` setting instead of forcing GitHub output and a job summary; check-only SARIF and badge selections use GitHub annotations for the auxiliary reports.
- GitHub coverage output now escapes untrusted skill names, and annotation file properties escape workflow-command delimiters. Drift batches scenario validation once per revision instead of rebuilding the corpus name set for every assertion.
- `skillcheck test` and `skillcheck diff` now reject check-only SARIF and badge formats with a usage error instead of silently falling back to pretty output.
- `skillcheck diff` now exits 2 when either the current or historical scenarios file is malformed. Contract comparison fails closed instead of emitting a clean JSON report after silently dropping regression coverage.
- Library compatibility: `DriftKind` gains `regressed`, `repaired`, and `allowed`. This widens an exported union and must be treated as a breaking API change when assigning the next published version.

## 1.0.1 — 2026-07-30

The first stable public release.

The release that answers the question the project is named after: **would this request actually reach this skill?** — and, new in this release, **did my change move the answer?**

### `skillcheck diff` — what a change did to which skill wins

- **`skillcheck diff [<ref>]`** compares the skill corpus in your working tree against the one at a git revision and reports every request whose answer moved. This is the question a pull request raises and the one nothing else in the toolchain can answer: a reviewer can see that a description changed, but no diff view can show that the change quietly moved a request from one skill to another, because that outcome isn't written in either file. It only exists in the comparison.
- **Zero configuration.** Probe requests come from the scenarios file when a repo keeps one, and otherwise from the skills' own descriptions — at *both* revisions, so an edited description is checked against the requests it used to claim as well as the ones it claims now. A repo that has never written a scenario gets full corpus coverage on its first run.
- **It cannot cry wolf.** Every judgemental rule has to decide whether some arrangement of text is *bad* and can be wrong about it. Drift decides nothing: it reports that an answer changed, and it changed because the author changed the text that decides it. There is nothing to be wrong about, which is why this needs no thresholds and no opt-outs.
- **Only three outcomes fail a build**, all of them things nobody asked for: a request that changed hands between skills the change did *not* edit (collateral drift), a request that stopped reaching anything at all, and a new *error* this change introduced. A narrowing lead, a request the edited skill now claims differently, an added skill and a renamed one are all reported and stay green — a check that fails on the expected consequences of an ordinary edit gets switched off inside a week and takes the useful signal with it. Adding a skill can fail in exactly one way, by taking a request the scenarios file pins to another skill; that is a human-written assertion being broken.
- **A scenario added in the same change is not compared.** A prompt written in this pull request has no answer at the base revision, and ranking it there invents one — so adding a skill *together with its scenario*, the workflow `skillcheck init` teaches, failed the build: an incumbent "won" a request that did not exist yet and the report called it a request changing hands. Scenario probes now come only from prompts asserted at both revisions, the same rule description probes already followed, and the report names what it declined to compare and points at `skillcheck test`, which does check it.
- **`diff` and `check` now discover skills by one predicate.** Git's listing matched any path merely *ending* in `SKILL.md` and entered every directory, while the filesystem walk requires the exact basename and skips `vendor/`, `dist/`, `node_modules/` and friends. On a completely clean working tree, a repo with a committed vendor copy and a `docs/EXAMPLE-SKILL.md` reported "3 skills there · 1 here · 2 removed" and five findings "fixed" — a diff against no change at all, with the phantoms shifting the historical index's idf and able to flip a real ranking.
- **A skill's identity across revisions is its file, not its `name`.** Comparing names made a pure rename — same file, same description — report every request it won as collateral drift and fail the build, about one unchanged skill under a new label. A repo with no skills at either revision now exits 0 rather than treating "nothing to compare" as a usage error, so the first pull request after `skillcheck init` isn't red.
- **A narrowing lead is reported even when nothing flipped.** A scenario that still passes but whose lead fell from 88% to 48% is one wording tweak from flipping, and no pass/fail check can say so.
- **New findings without a baseline file.** `diff` reports the findings a change introduced and the ones it resolved, ignoring everything already broken — the baseline feature with nothing to commit and nothing to keep current. Findings are identified by rule and file, not by message, so adding a third near-duplicate doesn't report a reworded `description-similarity` finding as one problem fixed and another introduced.
- Reading the historical revision uses `git ls-tree` to list and a single `git cat-file --batch` to stream every blob through one pipe, against the local object database. Nothing is fetched, checked out or stashed, and the working tree is never touched. A ref that isn't present locally — almost always a shallow CI clone — fails with a message naming `fetch-depth: 0` rather than attempting a network call. Blob content is walked as bytes, not decoded text, so a description written outside ASCII can't desynchronize the parser.
- The Action takes a **`diff`** input (pass `${{ github.event.pull_request.base.sha }}`), writes the comparison to the job summary as a table, and annotates the descriptions responsible. `skillcheck init` now scaffolds this, including the `fetch-depth: 0` it requires.

### Findings it should never have reported

Every item here was a live finding on a file that was correct, most at error severity — the failure the README calls existential, since a linter that cries wolf gets deleted and takes every other rule with it. All of them are now locked shut by [tests/false-positives.test.ts](tests/false-positives.test.ts).

- **`description-similarity` reported errors on skills about entirely unrelated things.** Ten skills covering pdf, kubernetes, stripe, figma and six other technologies, each written to one house template — *"Automates X operations for this repository. Use when the user asks to inspect, configure or troubleshoot X."* — produced ten errors, grade C and a failed build, every one of them claiming "the model can't reliably tell them apart". The same binary's ranking gave `troubleshoot my kubernetes ingress` to `kubernetes` by 89% over 1%: two subsystems reaching opposite verdicts about identical text, and the one that failed the build was the wrong one. Overlap is now weighted by how rare each shared term is in the repo, using the same idf the ranking uses, so six words of shared boilerplate no longer outvote the one topic word that distinguishes them. That corpus is now clean; genuine near-duplicates still error. Thresholds were recalibrated against measured shapes (identical descriptions 1.00, the same skill in synonyms 0.74, ten unrelated topics 0.14) rather than adjusted by feel, and the cases are asserted in [tests/false-positives.test.ts](tests/false-positives.test.ts).
  - **The message now names the words doing the colliding** — `88% similar to skills/b/SKILL.md on: invoice, billing, client` — rather than handing over a percentage and a filename and leaving the author to diff two sentences by eye.
  - **Below four skills the plain term ratio is kept.** Rarity weighting works by noticing that a word appearing in most descriptions carries no information, and that inference needs a corpus: with two or three skills every shared term is in most of them by arithmetic, so the weighting has nothing to discount and instead discounts the evidence. Two genuinely near-duplicate skills alone in a repo measured 0.34 weighted against 0.80 unweighted — reporting nothing there would have missed the most common shape of this failure, someone's first two skills. The cost is that a very small repo whose every skill shares one template can still be reported.
- **`when-to-use` rejected trigger clauses that don't use the words "use when".** The English pattern required literally `use this skill when`, so *"You MUST use this before any creative work"* — a description whose second clause is nothing but a trigger — was reported as having no trigger at all, at error severity. The filler between the verb and the preposition is now optional, and `use proactively`, `any time`, `must/should be used`, and `in response to` are recognized. Both phrasings are regression samples in the English pack, enforced by the language contract tests.
  - The first attempt at this went too far the other way and is worth recording: allowing `the <word>` as filler and adding `for`/`in` as prepositions made five of six capability-only descriptions pass — *"Provides a toolkit for use in data pipelines"*, *"Use the toolkit for extracting tables"*, *"Proactively monitors the build queue"* — which is the flagship rule quietly switching itself off, a worse outcome than the false positive it was fixing. The patterns now accept pronoun filler and temporal prepositions only, and `proactively` counts only when tied to the verb. All six are `capabilityOnly` samples now, so the trade cannot be made again by accident.
- **`when-to-use` ignored the `when_to_use` frontmatter field.** A skill that put its trigger in the field built for exactly that purpose — a field `unknown-keys` lists as one hosts read, and that the ranking in `match.ts` already indexes — was told its description "never says when to use this skill". The tool contradicting itself about the same file. Both fields are now searched.
- **`broken-references` and `no-placeholders` read code samples as prose.** A review skill whose job is to flag leftover markers earned a `broken-references` **error** and a `no-placeholders` warning for containing an example of one inside a fenced block. Both rules now read prose only, via a shared, line-position-preserving helper (`src/markdown.ts`); inline code spans are excluded too, and `body-not-empty` was moved onto the same helper so the three rules can no longer disagree about what counts as code in one file. An *unclosed* fence deliberately does not silence the rest of the body — CommonMark says it runs to the end of the document, and being right about that would let one stray fence line switch two checks off without saying so. Fences nested in a list item or a blockquote are recognized too: capping the opener's indent at CommonMark's three columns rejected exactly the two places a skill body puts a code sample, so the false positive kept firing on the shape a body mostly consists of.
- **`unknown-keys` warned about vendor extensions.** `x-my-tool` was reported as "not read by any known host" — while skillcheck's own suppression key is `x-skillcheck`. `x-`-prefixed keys are now exempt, except for a near-miss of skillcheck's own key, which silently suppresses nothing and is exactly the invisible typo the rule exists for.
- **`--fix` could turn a loadable SKILL.md into one no host would parse.** `description: “Runs the "fast" suite. Use when asked.”` is valid YAML — a plain scalar whose curly quotes are ordinary characters. Replacing both delimiters with `"` produced `"Runs the "fast" suite…"` and wrote it to disk: 95/100 (A) became 75/100 (C) with a `frontmatter-valid` error, courtesy of the one rule whose own documentation says *a fix that can break a working file has no business being called safe*. The rule now substitutes the other ASCII quote when the body contains the first, and reports without fixing when neither is safe. **And the fix loop now discards any pass whose output parses worse than its input**, which makes the guarantee structural rather than a promise each new fixer has to keep on its own.
- **`smart-quotes` flagged its own documentation.** It reported every curled character, including en dashes, em dashes and ellipses, on the theory that they aren't portable across strict YAML parsers. They are — and copying the `when-to-use` rule's own documented "Passes" example into a skill produced a warning. The rule is now narrowed to the two shapes with a named failure: invisible spaces (a no-break space is not whitespace to a YAML parser, and is invisible in every editor and diff), and curly quotes *wrapping an entire value*, which a host keeps verbatim. A lone opening curly quote is deliberately left alone: replacing it produces an unterminated scalar, so the "safe" fix could break a working file.
- **A sole, unambiguous winner was reported as "no skill covers this request".** Coverage was measured against every content term in the request, and a real request is mostly words no description will ever contain. Ask *"help me set up a new webhook"* of a repo whose webhook skill is the only candidate and holds 100% of the score, and `help`, `set` and `new` outvoted the one word that decided the ranking — verdict `none`, and `skillcheck test` failing a build about the right answer. The more naturally a request was phrased, the likelier the failure, which inverted the documentation's own advice to use the words a real user would type. Coverage is now measured over *matchable* terms — those occurring in at least one skill — and the terms that could never have matched are named in the output, so a win on thin evidence still shows as one. **This can change the outcome of an `expect: none` scenario**; a request sharing a distinctive word with exactly one skill now reaches it.

### Verdicts that say what they mean

- **A coin flip is now the whole contender block, not the top two.** The margin compares first place to second, which is right when two skills collide and wrong when five do: a ten-way tie reported a 0% gap between the arbitrary two that sorted highest and said nothing about the other eight. `close` now fires when any skill sits within the margin of the leader, and the output names how many others are tied.
- **`why` names the words behind a tie.** A coin-flip verdict stopped one sentence short of an action — two skills tie at 14%, and the author was left to guess which word did it. The output now lists the terms the contenders share and the terms each one holds alone, rarest first. Both are facts about text the author wrote rather than advice, and the useful case is the empty one: a contender with *nothing* of its own cannot be separated by any rewording, so one of the two skills should not exist.

### Claims that are now checked

- **Every console block in the README and docs is re-run and compared against real output** (`npm run check:examples`, in CI). The shipped README claimed `53% / 47% / by only 12%` for a `why` invocation whose real answer was `54% / 46% / by only 14%` — a fabricated-looking screenshot in the one place a measurement tool cannot afford one. `npm run docs:examples` rewrites the blocks from what the tool actually prints.
- **The README's headline demo is a committed fixture.** `tests/fixtures/readme` reproduces it exactly, so anyone can run `cd tests/fixtures/readme && npx skillcheck .` and get the numbers in the README, including the 77/100 (C).
- **skillcheck passes its own rules.** It scored 78/100 (C) on itself, because it linted its own deliberately-broken test fixtures. A `skillcheck.config.json` now excludes them, `npm run selfcheck` is part of `npm run check` and of CI, and the project ships a real skill of its own ([skills/skill-activation-review](skills/skill-activation-review/SKILL.md)) rather than only linting other people's.

### Launch readiness

- Fixed the GitHub-only color-sensitive test that left the public CI badge red while the same 497-test suite passed locally.
- Canonicalized Windows revision paths before containment checks, so filesystem aliases no longer make `skillcheck diff` reject paths inside the repository as external.
- Generated references and verified console examples normalize checkout line endings, so Windows does not report unchanged documentation as stale.
- The CI smoke tests now exercise their deliberately good and bad fixtures outside the repository's self-check exclusions instead of reporting an empty corpus as clean.
- npm 11 preserves the packaged CLI entry point, and the release check rejects a manifest that npm would silently strip.
- The release workflow is now parsed by `npm run check`, publishes npm before preparing the GitHub release, maintains the floating `v1` Action tag, and leaves a Marketplace-ready draft for the owner.
- Each Action release resolves the matching exact npm version, so even an immutable `uses: mirawren/skillcheck@v1.0.1` tag stays reproducible; the moving `v1` tag advances both together.
- `skillcheck init` now installs the `mirawren/skillcheck@v1` Action. That removes redundant workflow steps and makes genuine adoption visible in GitHub's dependency graph; Node repositories still receive a versioned devDependency.
- Claude Code plugin checks now match the official contract: `plugin.json` is optional, and a present manifest requires only `name`. Missing `version` remains a publishing warning rather than an installation error.
- Added maintainer, release, and Claude for Open Source evidence guides for a verifiable public project and qualified, non-duplicative applications.

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

## 1.0.0 — 2026-07-30

The immutable tag was pushed, but its workflow stopped before publishing npm or creating a GitHub release. Do not use this version; 1.0.1 is the first installable stable release.

## 0.2.0

- `skillcheck.config.json`: per-rule `off`/`warn`/`error`, per-rule option thresholds, `ignore` globs.
- Per-skill suppression via `x-skillcheck: { disable: [...] }` in frontmatter.
- `--format sarif` for GitHub code scanning.

## 0.1.0

- First release: 8 rules for `SKILL.md`, plugin-manifest checks, pretty/json/github output, and the GitHub Action.

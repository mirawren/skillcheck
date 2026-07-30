# skillcheck

**When an agent skips your skill, nothing errors. No warning, no log line, no failed build. skillcheck is the preflight for that silence — offline, in CI.**

[![CI](https://github.com/mirawren/skillcheck/actions/workflows/ci.yml/badge.svg)](https://github.com/mirawren/skillcheck/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/skillcheck)](https://www.npmjs.com/package/skillcheck)
[![node](https://img.shields.io/node/v/skillcheck)](https://www.npmjs.com/package/skillcheck)
[![license](https://img.shields.io/npm/l/skillcheck)](LICENSE)

A skill's `description` is the only text a model reads before deciding whether to load it. Get it wrong and nothing errors — no warning, no log line. The skill just doesn't get picked, on someone else's machine, and you find out from a bug report that says "it didn't do the thing".

`skillcheck` checks that text before you ship it, along with the fourteen other ways a `SKILL.md` breaks quietly — in [24 languages](docs/languages.md), because a skill that never triggers fails the same way in every one of them. It runs offline, in under a second, with no credentials.

<!-- verify: why "review my code changes before I commit" . cwd=tests/fixtures/bad exit=0 -->

```console
$ npx skillcheck why "review my code changes before I commit"

request  review my code changes before I commit
terms    review, code, change, commit

  1.  review-me  ███████████░░░░░░░░░  54%  review code change commit
  2.  grill-me   █████████░░░░░░░░░░░  46%  review code change commit

  ⚠ coin flip — review-me leads grill-me by only 14%
    their descriptions tie on: bug, case, change, code, commit, edge
    only review-me: problem, repository
    only grill-me: issue, repo

  BM25 over each skill's name + description. A deterministic model of the retrieval
  step, not a prediction of the model's choice — read a near-tie as a real risk and a
  clear win as "nothing in your wording is working against you".
```

That's skillcheck's lane: **it ranks your skills against a real request**, tells you when the choice between them is a coin flip, and names the words that caused it. Those last three lines are the whole diagnosis — two descriptions saying the same thing in synonyms, and neither holding vocabulary the other doesn't. No rewording separates skills like that; one of them should go.

It's a lexical model of the retrieval step, not a model run — a near-tie is a real risk, a clear win means nothing in your wording is working against you. [What that does and doesn't tell you](docs/trigger-simulation.md), stated precisely.

The console blocks in this README that can be reproduced from a committed fixture carry a marker naming the command that produced them, and CI re-runs every one and compares it to real output — so a number here that drifted from the tool is a failed build, not a stale screenshot. The `diff` block below is the exception: it needs a git repository with two revisions, so it is transcribed from a real run rather than regenerated.

And the check itself:

<!-- verify: . --quiet cwd=tests/fixtures/readme exit=1 -->

```console
$ npx skillcheck . --quiet          # errors only; drop --quiet for the warnings too

skills/grill-me/SKILL.md
  ✖ description is 74% similar to skills/review-me/SKILL.md on: bug, case, change, code, commit — the model can't reliably tell them apart (description-similarity):1
      Overlapping descriptions make triggering a coin flip between the two skills. Overlap is weighted by how rare each shared word is in this repo, so the words named above are the ones actually binding the two together — shared boilerplate counts for almost nothing. Sharpen each description around the situations only IT covers, or merge the skills.

skills/pdf-report/SKILL.md
  ✖ `description` never says when to use this skill — it describes a capability, not a trigger (when-to-use):1
      The model picks skills by matching the request against the description. Add trigger contexts, e.g. "Use when the user asks to extract text from a PDF, fill a PDF form, or merge PDF files." Capability-only descriptions are the top documented cause of skills that activate ~50% of the time.
  ✖ links to `templates/report.hbs`, which does not exist in the skill folder (broken-references):8
      The model will try to read this path at runtime and silently fail. Fix the path or add the file.

skills/review-me/SKILL.md
  ✖ description is 74% similar to skills/grill-me/SKILL.md on: bug, case, change, code, commit — the model can't reliably tell them apart (description-similarity):1
      Overlapping descriptions make triggering a coin flip between the two skills. Overlap is weighted by how rare each shared word is in this repo, so the words named above are the ones actually binding the two together — shared boilerplate counts for almost nothing. Sharpen each description around the situations only IT covers, or merge the skills.

4 errors, 1 warning (5 skills checked)
Skill health: 79/100 (C)
```

<details>
<summary>The same run with warnings — including the two findings no per-file linter can produce</summary>

<!-- verify: . cwd=tests/fixtures/readme exit=1 -->

```console
$ npx skillcheck .

skills/changelog-writer/SKILL.md
  ⚠ shadowed by skills/release-manager/SKILL.md — its description already covers every distinctive word of this one (ask, changelog, git, history, write) (trigger-shadowing):1
      Any request worded around this skill reads as a request for the broader one too, so which fires is arbitrary. Narrow the broader skill to what it should own, or give this one vocabulary the other does not claim. `skillcheck why "<a request this skill should win>"` shows the ranking.

skills/grill-me/SKILL.md
  ✖ description is 74% similar to skills/review-me/SKILL.md on: bug, case, change, code, commit — the model can't reliably tell them apart (description-similarity):1
      Overlapping descriptions make triggering a coin flip between the two skills. Overlap is weighted by how rare each shared word is in this repo, so the words named above are the ones actually binding the two together — shared boilerplate counts for almost nothing. Sharpen each description around the situations only IT covers, or merge the skills.

skills/pdf-report/SKILL.md
  ✖ `description` never says when to use this skill — it describes a capability, not a trigger (when-to-use):1
      The model picks skills by matching the request against the description. Add trigger contexts, e.g. "Use when the user asks to extract text from a PDF, fill a PDF form, or merge PDF files." Capability-only descriptions are the top documented cause of skills that activate ~50% of the time.
  ✖ links to `templates/report.hbs`, which does not exist in the skill folder (broken-references):8
      The model will try to read this path at runtime and silently fail. Fix the path or add the file.

skills/review-me/SKILL.md
  ✖ description is 74% similar to skills/grill-me/SKILL.md on: bug, case, change, code, commit — the model can't reliably tell them apart (description-similarity):1
      Overlapping descriptions make triggering a coin flip between the two skills. Overlap is weighted by how rare each shared word is in this repo, so the words named above are the ones actually binding the two together — shared boilerplate counts for almost nothing. Sharpen each description around the situations only IT covers, or merge the skills.

4 errors, 1 warning (5 skills checked)
Skill health: 79/100 (C)
```

`trigger-shadowing` and `description-similarity` are the cross-skill checks: they need the whole corpus, and they are the ones that catch a skill made unreachable by a sibling rather than broken on its own. Reproduce any of this in a clone with `cd tests/fixtures/readme && npx skillcheck .`.
</details>

## Get started

```sh
npx skillcheck .          # check every skill and plugin manifest here
npx skillcheck diff main  # what your change did to which skill wins
npx skillcheck init       # add CI, trigger tests and a score badge
npx skillcheck languages  # which languages your skills are written in
```

`init` writes a GitHub workflow, a starter scenarios file seeded from your own skills — so the first run passes — and prints the badge snippet. That's the whole adoption path.

Works with [Agent Skills](https://agentskills.io) (`SKILL.md`) as used by Claude Code, Codex, Cursor and other agent tools. It also checks the optional Claude Code `plugin.json` for valid JSON, its required `name`, and deliberate versioning; use [`claude plugin validate`](https://code.claude.com/docs/en/plugins-reference#debugging-and-development-tools) for Claude's complete host-specific schema.

## What your change did to which skill wins

This is the question a pull request raises, and the one nothing else can answer. A reviewer can see that a description changed. No diff view can show that the change quietly moved a request from one skill to another — because that outcome isn't written in either file. It only exists in the comparison.

```console
$ npx skillcheck diff main

comparing against main
  2 skills there · 2 here · 1 retriggered

scenario regressed — a checked-in activation contract passed there and fails here
  ✖ "write release notes from the git log"  your scenarios file
      changelog-writer → release-manager — expected changelog-writer, but release-manager ranked first

lead narrowed — the same skill still wins, by a margin that is no longer safe
  ⚠ "Writes a changelog from git history."  changelog-writer's own description
      changelog-writer still wins, but its lead fell from 88% to 48%

1 scenario regressed, 1 lead narrowed
  4 probes: 1 from your scenarios file, 3 from your own descriptions. Same BM25 ranking as `why`, run twice.
```

Someone widened `release-manager` by one clause. Both files still lint clean, both descriptions still read well, and a request that belonged to the narrow skill now goes to the broad one.

**Zero configuration.** The requests come from your scenarios file if you keep one, and otherwise from the skills' own descriptions — at *both* revisions, so an edited description is checked against the requests it used to claim as well as the ones it claims now.

**And it reads the contract, not just the winner.** A scenario may allow either of two skills, forbid only the dangerous one, or require that nothing fires. `diff` evaluates that assertion on both revisions: a passing contract that starts failing is a regression; a repair or a move between allowed winners stays green. If the assertion itself changed in the pull request, it has no stable meaning to compare, so `diff` leaves it to `skillcheck test` instead of inventing a before-state.

What fails a build is deliberately narrow — the four outcomes nobody asked for:

| | |
| --- | --- |
| **scenario regressed** | a checked-in `expect`, `forbid`, or `expect: none` contract passed before and fails now |
| **changed hands** | a request moved between two skills you *weren't* editing — the failure a normal diff cannot show |
| **no longer reaches anything** | a request that used to find a skill now matches none |
| **a new error** | a finding this change introduced, ignoring everything already broken |

Everything else is reported and stays green: a repaired scenario, movement between allowed winners, a narrowing lead, a request the skill you just rewrote now claims differently, a skill you added, or a skill you renamed. A check that fails on the expected consequences of an ordinary edit gets switched off inside a week, and takes the useful signal with it.

Adding a skill never fails for its own description — a newcomer's own words would trivially "change hands" to it. It can still fail by breaking a stable scenario contract, which is the same regression `skillcheck test` reports on the current tree.

That last row is also the baseline feature without the baseline file: a repo adopting skillcheck mid-life gets *only what this change broke* on its first run, with nothing to commit and nothing to keep current.

```sh
npx skillcheck diff                 # against your last commit
npx skillcheck diff origin/main     # against a base branch
npx skillcheck diff --format json   # for a bot to comment with
```

Reading a past revision uses `git cat-file`, so nothing is checked out, stashed or fetched, and your working tree is never touched.

## Trigger tests

Ordinary lint rules read one file at a time. The interesting failures are about *competition* between skills, and they only appear when you ask a question a user would ask.

Write those questions down:

```yaml
# skillcheck.scenarios.yaml
version: 1

scenarios:
  - prompt: "turn this markdown into a printable pdf report"
    expect: pdf-report

  - prompt: "write release notes from the git log"
    expect: changelog-writer

  - prompt: "what time is it in Tokyo"
    expect: none          # nothing should claim this

  - prompt: "get rid of that old draft"
    forbid: pdf-publish   # whatever takes this, it isn't the one that ships
```

<!-- verify: test cwd=tests/fixtures/readme exit=1 -->

```console
$ npx skillcheck test

skillcheck.scenarios.yaml — 3 scenario(s) against 5 skill(s)

  ✔ "turn this markdown into a printable pdf report"
      → pdf-report
  ✖ "write release notes from the git log"
      → release-manager — expected changelog-writer, but release-manager ranked first
  ✔ "what time is it in Tokyo"
      → no skill

2 passed, 1 failed (3 scenarios)

Assertion coverage: 2/5 skills named in expect or forbid
  Not named: grill-me, release-manager, review-me
  Add expect or forbid scenarios for requests at those skills' boundaries.
```

That second line is the `trigger-shadowing` warning cashed out: the broad `release-manager` swallows a request the narrow skill was written for. A scenario that only just passes is reported as *too close to call* rather than green.

Now "my skill stopped triggering after I added another one" is a failed build with a diff attached, instead of a support thread. Scoring is deterministic — a scenario changes only when *you* change the text that decides.

The coverage line keeps a small green suite honest. It reports which scanned skills are named by at least one `expect` or `forbid` assertion, and lists the ones that are not. It is deliberately informational: `expect: none` still protects the corpus boundary, and one arbitrary percentage should not decide whether a pull request ships.

**`forbid` is the one that scales.** Past a handful of skills, `expect` over-specifies: it pins an exact winner, so an unrelated edit fails a scenario that was never really about that. `forbid` states what you actually mean — *the destructive one never takes this* — and keeps holding as the repo grows. It's also the right shape when being wrong is expensive: you don't need to know which skill handles a request to know which one must not. A forbidden skill that merely *trails* the winner by a hair is reported too, because that's one wording tweak from taking it.

Full format reference, including the compatibility promise: **[docs/scenarios.md](docs/scenarios.md)**.

## What it catches

15 checks, each tied to a documented way a skill breaks. Full reference with examples: **[docs/rules.md](docs/rules.md)**, or `skillcheck explain <rule>` in the terminal.

| Rule | | Catches |
| --- | :---: | --- |
| `when-to-use` | | **the flagship** — a description that states a capability but never says *when* to use the skill |
| `description-similarity` | | two skills worded so alike that triggering becomes arbitrary |
| `trigger-shadowing` | | a skill whose defining words a broader sibling already covers — installed, valid, unreachable |
| `cross-language-trigger` | | in a multilingual repo, a skill no request in the other languages can reach |
| `frontmatter-valid` | | missing or unparseable frontmatter, missing `name`/`description` |
| `name-format` | 🔧 | names the spec rejects, or that disagree with the folder |
| `description-length` | | over the 1024-char limit, or too short to match anything |
| `description-third-person` | | "I can help you…" — [against Anthropic's authoring guidance](docs/rules.md#description-third-person) |
| `smart-quotes` | 🔧 | invisible spaces, and curly quotes wrapping a value a host will keep verbatim |
| `unknown-keys` | 🔧 | `descripton:` — the typo that makes a skill silently description-less |
| `body-not-empty` | | a body that is only a title: fires, then does nothing |
| `body-size` | | bodies over the recommended budget, paid on every activation |
| `broken-references` | | links to files that don't exist — the model follows a dead pointer |
| `no-placeholders` | | `TODO` and `<your-api-key>` shipped to users |
| `plugin-manifest` | | plugin.json missing its required name or using an invalid/unpinned version |

🔧 = `skillcheck --fix` repairs it.

## Your skills don't have to be in English

Nothing about a skill that never fires is specific to English. The description is
still the only text the model reads; it can still name a capability instead of a
trigger. But a linter that splits on `[^a-z0-9]+` doesn't just miss those failures
elsewhere — it invents new ones. A Japanese description becomes two loanwords, a
Russian one becomes nothing at all, and every check downstream reports confident
nonsense about the empty set that's left.

So skillcheck segments by Unicode script and reads stopwords and trigger phrasings
from a **[24-language](docs/languages.md) registry**:

<!-- verify: languages . cwd=tests/fixtures/multilingual exit=0 head=8 -->

```console
$ npx skillcheck languages

Your skills

  English            1 skill  skills/pdf-report/SKILL.md
  Japanese (日本語)  1 skill  skills/gijiroku/SKILL.md
  Chinese (中文)     1 skill  skills/tubiao/SKILL.md

A request reaches a skill through shared words, and two languages share almost
none — so these groups rank separately. See the cross-language-trigger rule.
…
```

That last line is a real failure, and it only exists once a repo has authors from
more than one country: **a skill described only in Japanese is not outranked by an
English request, it is unreachable by one.** There is no term in common to rank
on. The skill installs, validates, and never fires for half the team — silently,
forever. `cross-language-trigger` reports it, and `why` explains it from the other
side:

<!-- verify: why "turn a spreadsheet into a chart" . cwd=tests/fixtures/multilingual exit=0 -->

```console
$ npx skillcheck why "turn a spreadsheet into a chart"

request  turn a spreadsheet into a chart
terms    turn, spreadsheet, chart

  ✖ no skill matched a single term of this request
    2 skills here are described in another language, so no term in them could match a
    request in English: Japanese (日本語) 1, Chinese (中文) 1. Ask in that language,
    or give them a term that survives translation — see the cross-language-trigger
    rule.

  BM25 over each skill's name + description. A deterministic model of the retrieval
  step, not a prediction of the model's choice — read a near-tie as a real risk and a
  clear win as "nothing in your wording is working against you".
```

The fix is usually already in the sentence: `PDF`, `Markdown`, `git`, `Excel` are
the words a request contains whatever language it's asked in, and one of them is
enough.

Where skillcheck can't tell, it says nothing — a language with no pack never gets
an error it can't justify, because a false positive about a skill that was fine is
what gets a linter deleted. [How detection and segmentation work, and what the
bigram approximation does and doesn't buy you](docs/languages.md).

**Your language missing?** [Adding it](CONTRIBUTING.md#add-your-language) is one
self-contained file of pure data — no dependencies, no changes to the tokenizer,
about an hour. The test suite enforces the contract, so a reviewer who doesn't
read your language can still merge it with confidence.

## In CI

```yaml
# .github/workflows/skillcheck.yml
name: skillcheck
on: [pull_request]
jobs:
  skillcheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0        # so the base revision is readable
      - uses: mirawren/skillcheck@v1
        with:
          path: "."
          diff: ${{ github.event.pull_request.base.sha }}
```

Findings and failing trigger contracts appear as PR annotations, with both lint and scenario tables in the job summary. The action exposes `score`, `grade`, `errors`, `warnings` and `skills` as outputs, so you can gate on the score or commit a badge from the same run. If a scenarios file exists, it runs those too and shows direct assertion coverage.

`diff` is what makes the check about *this* pull request: it adds the activation comparison above, and its findings land in the job summary as a table you can read without expanding a log. Leave it out and everything else still works — but a shallow clone can't read the base revision, which is why `fetch-depth: 0` is there. `skillcheck init` writes all of this for you.

<details>
<summary>Upload to GitHub code scanning instead (SARIF)</summary>

```yaml
      - run: npx --yes skillcheck . --format sarif > skillcheck.sarif
        continue-on-error: true
      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: skillcheck.sarif
```

Findings land in **Security → Code scanning** with history and dedup, and each alert carries the rule's full explanation and a corrected example.
</details>

<details>
<summary>Publish a live score badge</summary>

```yaml
      - run: npx --yes skillcheck . --format badge > .github/badges/skillcheck.json
```

Commit that file and reference it:

```md
[![skillcheck](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/USER/REPO/main/.github/badges/skillcheck.json)](https://github.com/mirawren/skillcheck)
```
</details>

Exit codes: `0` clean, `1` findings, `2` bad usage. Output formats: `pretty`, `github`, `json`, `sarif`, `markdown`, `badge`.

## Skill health score

Every run ends with a score out of 100 and a letter grade, computed the boring way so it means the same thing in every repo:

```
unit score = 100 − 25·errors − 5·warnings   (clamped to 0–100)
repo score = the mean across every scanned skill and manifest
```

A clean skill scores 100 and counts, so adding good skills raises the average instead of diluting it. One error costs a grade; warnings are cheaper because the skill still works.

## Autofix

```console
$ npx skillcheck . --fix
  ✔ fixed 1 file(s) — name-format, smart-quotes
```

Only mechanical, unambiguous repairs: kebab-casing an invalid `name`, renaming a typo'd key, replacing curly quotes with ASCII. It is deliberately timid — it won't rename your folders, and it won't rename `descripton` onto a `description` you already have. Use `--fix-dry-run` to see the list first.

## Adopting it in a repo that already has findings

The reason a linter doesn't get adopted is never the rules — it's the first run turning up sixty findings nobody has time for today. So record them:

```sh
npx skillcheck . --update-baseline    # writes .skillcheck-baseline.json, commit it
```

From then on CI fails only on findings that are **new**. The backlog gets paid down whenever someone touches that skill, and skillcheck tells you when a baseline entry no longer occurs so the file can't rot.

The score keeps counting baselined findings on purpose. A baseline decides what fails CI; it never flatters the badge.

## Configuration

Everything is optional. Drop a `skillcheck.config.json` at the repo root:

```json
{
  "rules": {
    "body-size": "off",
    "when-to-use": "warn"
  },
  "options": {
    "description-similarity": { "warnAt": 0.6, "errorAt": 0.8 }
  },
  "ignore": ["examples/**"]
}
```

Or silence one finding on one skill, in its own frontmatter:

```yaml
x-skillcheck:
  disable: [when-to-use]   # or  disable: "*"
```

A rule set to `"off"` isn't run at all. `skillcheck explain <rule>` prints every option a rule accepts.

## Where it fits

| Question | skillcheck | [`skills-ref`](https://github.com/agentskills/agentskills) / [`claude plugin validate`](https://code.claude.com/docs/en/plugins-reference#debugging-and-development-tools) | [Security scanners](https://github.com/cisco-ai-defense/skill-scanner) | [Real-agent evals](https://github.com/microsoft/waza) |
| --- | :---: | :---: | :---: | :---: |
| Is the file or manifest structurally valid? | ✅ | ✅ | varies | varies |
| Which sibling would this request reach? | ✅ | — | — | observed from a model run |
| Did a PR change that answer? | ✅ `diff`, offline, no config | — | — | ✅, with a runtime and credentials |
| Is an installed skill malicious? | — | — | ✅ | — |
| Works without a model, network or API key? | ✅ | ✅ | varies | — |

These tools are complementary. Use the host's validator for its complete schema, a security scanner on skills you install from other people, and skillcheck for fast activation regressions in the skills you maintain. Add real-agent evals when you need model-level evidence rather than a deterministic preflight.

**What it deliberately isn't:**

- **Not a security scanner.** It tells you whether your own skills work, not whether someone else's is hostile.
- **Not a prose style checker.** Every rule maps to a documented failure: won't load, won't trigger, wastes tokens, dead reference. If a check can't name the failure, it doesn't ship.
- **Not a translator.** It never rewrites your description, and never suggests you write it in English.
- **Not model-dependent.** No network, no credentials, no API keys, two dependencies, no postinstall. It runs the same way on a fork's pull request as on yours — see [SECURITY.md](SECURITY.md).

## Performance

Measured with `npm run bench` on a synthetic corpus (Apple M-series, Node 22):

| Skills | Time |
| --- | --- |
| 200 | 23 ms |
| 1,000 | 127 ms |
| 3,000 | 0.6 s |

Fast enough that nobody notices it in a pre-commit hook, and fast enough to lint a whole marketplace.

## Roadmap

- [ ] **`skillcheck eval`** — model-in-the-loop trigger testing through headless `claude -p` / `codex exec`: did the skill *actually* fire? Opt-in and credentialed, the complement to the offline simulation.
- [ ] **A published agreement rate** — run `eval` once, commit what the model actually picked, and report how often the offline verdict agreed. The honest answer to "why should I trust a lexical simulation?" is a number, not a paragraph.
- [ ] **A pinned false-positive corpus** — third-party skills labelled known-good, gating this repo's own CI, so a rule change that flags a correct file is a red build. It is also the only way a maintainer who doesn't read Turkish can safely merge a Turkish pattern.
- [ ] **Cross-host parity** — which frontmatter each host really reads, checked in and kept current.
- [ ] `CLAUDE.md` / `AGENTS.md` checks — size budgets, dead paths, contradictions with a skill.
- [ ] Exact token counts as an opt-in, instead of the 4-chars-per-token estimate.

## Contributing

Two contributions matter most, and both are small.

**[Add your language.](CONTRIBUTING.md#add-your-language)** One self-contained file of pure data — stopwords, the phrasings your language uses for "use this when…", and a couple of worked examples. No dependencies, no changes to the tokenizer, and nobody else can do it for you. The [test suite enforces the contract](tests/languages.test.ts), so it can be reviewed by someone who doesn't read the language.

**[Add a rule.](CONTRIBUTING.md)** Most are under 100 lines including tests; [docs/GOOD_FIRST_RULES.md](docs/GOOD_FIRST_RULES.md) is a backlog of checks that are ready to be written.

And the one that helps most of all: run skillcheck on your own skills and file [a false positive](https://github.com/mirawren/skillcheck/issues/new?template=false-positive.md) if it flags something that's actually fine. Those get priority — a linter that cries wolf gets deleted, and it takes every other rule with it.

Maintainers and contributors who already do substantive open-source work can use the source-linked [Claude for Open Source eligibility and evidence guide](docs/claude-for-oss.md). It helps qualified individuals document real work; contributing to skillcheck by itself does not establish eligibility.

Project decisions and release responsibilities are documented in [MAINTAINERS.md](MAINTAINERS.md). Maintainer release steps are in [RELEASING.md](RELEASING.md).

## License

[MIT](LICENSE)

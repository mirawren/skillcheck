# skillcheck

**When an agent skips your skill, nothing errors. No warning, no log line, no failed build. skillcheck is the preflight for that silence — offline, in CI.**

[![CI](https://github.com/mirawren/skillcheck/actions/workflows/ci.yml/badge.svg)](https://github.com/mirawren/skillcheck/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/skillcheck)](https://www.npmjs.com/package/skillcheck)
[![node](https://img.shields.io/node/v/skillcheck)](https://www.npmjs.com/package/skillcheck)
[![license](https://img.shields.io/npm/l/skillcheck)](LICENSE)

A skill's `description` is the only text a model reads before deciding whether to load it. Get it wrong and nothing errors — no warning, no log line. The skill just doesn't get picked, on someone else's machine, and you find out from a bug report that says "it didn't do the thing".

`skillcheck` checks that text before you ship it, along with the fourteen other ways a `SKILL.md` breaks quietly — in [24 languages](docs/languages.md), because a skill that never triggers fails the same way in every one of them. It runs offline, in under a second, with no credentials.

```console
$ npx skillcheck why "review my code changes before I commit"

request  review my code changes before I commit
terms    review, code, change, commit

  1.  review-me  ███████████░░░░░░░░░  53%  review code change commit
  2.  grill-me   █████████░░░░░░░░░░░  47%  review code change commit

  ⚠ coin flip — review-me leads grill-me by only 12%
```

That's the part no other linter does: **it ranks your skills against a real request** and tells you when the choice between them is a coin flip.

It's a lexical model of the retrieval step, not a model run — a near-tie is a real risk, a clear win means nothing in your wording is working against you. [What that does and doesn't tell you](docs/trigger-simulation.md), stated precisely.

And the check itself:

```console
$ npx skillcheck .

skills/changelog-writer/SKILL.md
  ⚠ shadowed by skills/release-manager/SKILL.md — its description already covers
    every distinctive word of this one (ask, changelog, git, history, write)

skills/grill-me/SKILL.md
  ✖ description is 90% similar to skills/review-me/SKILL.md — the model can't
    reliably tell them apart

skills/pdf-report/SKILL.md
  ✖ `description` never says when to use this skill — it describes a capability,
    not a trigger
  ✖ links to `templates/report.hbs`, which does not exist in the skill folder

4 errors, 3 warnings (5 skills checked)
Skill health: 77/100 (C)
```

## Get started

```sh
npx skillcheck .          # check every skill and plugin manifest here
npx skillcheck init       # add CI, trigger tests and a score badge
npx skillcheck languages  # which languages your skills are written in
```

`init` writes a GitHub workflow, a starter scenarios file seeded from your own skills — so the first run passes — and prints the badge snippet. That's the whole adoption path.

Works with [Agent Skills](https://agentskills.io) (`SKILL.md`) as used by Claude Code, Codex, Cursor and other agent tools, and with Claude Code plugins (`.claude-plugin/plugin.json`).

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

```console
$ npx skillcheck test

  ✔ "turn this markdown into a printable pdf report"
      → pdf-report
  ✖ "write release notes from the git log"
      → release-manager — expected changelog-writer, but release-manager ranked first
  ✔ "what time is it in Tokyo"
      → no skill

2 passed, 1 failed (3 scenarios)
```

That second line is the shadowing warning above, cashed out: the broad `release-manager` swallows a request the narrow skill was written for. A scenario that only just passes is reported as *too close to call* rather than green.

Now "my skill stopped triggering after I added another one" is a failed build with a diff attached, instead of a support thread. Scoring is deterministic — a scenario changes only when *you* change the text that decides.

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
| `smart-quotes` | 🔧 | curly quotes and non-breaking spaces that strict YAML parsers reject |
| `unknown-keys` | 🔧 | `descripton:` — the typo that makes a skill silently description-less |
| `body-not-empty` | | a body that is only a title: fires, then does nothing |
| `body-size` | | bodies over the recommended budget, paid on every activation |
| `broken-references` | | links to files that don't exist — the model follows a dead pointer |
| `no-placeholders` | | `TODO` and `<your-api-key>` shipped to users |
| `plugin-manifest` | | plugin.json missing required fields or a pinnable version |

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

```console
$ npx skillcheck languages

Your skills

  English            2 skills skills/pdf-report/SKILL.md, skills/review-me/SKILL.md
  Japanese (日本語)  2 skills skills/gijiroku/SKILL.md, skills/seikyusho/SKILL.md
  Bengali (বাংলা)    1 skill  skills/riport/SKILL.md

A request reaches a skill through shared words, and two languages share almost
none — so these groups rank separately. See the cross-language-trigger rule.
```

That last line is a real failure, and it only exists once a repo has authors from
more than one country: **a skill described only in Japanese is not outranked by an
English request, it is unreachable by one.** There is no term in common to rank
on. The skill installs, validates, and never fires for half the team — silently,
forever. `cross-language-trigger` reports it, and `why` explains it from the other
side:

```console
$ npx skillcheck why "turn a spreadsheet into a chart"

request  turn a spreadsheet into a chart
terms    turn, spreadsheet, chart

  ✖ no skill matched a single term of this request
    3 skills here are described in another language, so no term in them could match a
    request in English: Japanese (日本語) 2, Bengali (বাংলা) 1. Ask in that language,
    or give them a term that survives translation — see the cross-language-trigger
    rule.
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
      - uses: actions/checkout@v4
      - uses: mirawren/skillcheck@v1
        with:
          path: "."
```

Findings appear as inline PR annotations, plus a markdown report in the job summary. The action exposes `score`, `grade`, `errors`, `warnings` and `skills` as outputs, so you can gate on the score or commit a badge from the same run. If a scenarios file exists, it runs those too.

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

## How it compares

| | skillcheck | Structure linters | Agent security scanners |
| --- | --- | --- | --- |
| Frontmatter and schema validity | ✅ | ✅ | — |
| Will the skill ever trigger | ✅ | — | — |
| Two skills competing for one request | ✅ | — | — |
| Rank a real request against your skills | ✅ | — | — |
| Trigger regression tests in CI | ✅ | — | — |
| Works on skills not written in English | ✅ | — | — |
| Malicious or injected instructions | — | — | ✅ |

They're complementary. Run a security scanner on skills you install from other people; run skillcheck on the ones you write.

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
- [ ] **Cross-host parity** — which frontmatter each host really reads, checked in and kept current.
- [ ] `CLAUDE.md` / `AGENTS.md` checks — size budgets, dead paths, contradictions with a skill.
- [ ] Exact token counts as an opt-in, instead of the 4-chars-per-token estimate.

## Contributing

Two contributions matter most, and both are small.

**[Add your language.](CONTRIBUTING.md#add-your-language)** One self-contained file of pure data — stopwords, the phrasings your language uses for "use this when…", and a couple of worked examples. No dependencies, no changes to the tokenizer, and nobody else can do it for you. The [test suite enforces the contract](tests/languages.test.ts), so it can be reviewed by someone who doesn't read the language.

**[Add a rule.](CONTRIBUTING.md)** Most are under 100 lines including tests; [docs/GOOD_FIRST_RULES.md](docs/GOOD_FIRST_RULES.md) is a backlog of checks that are ready to be written.

And the one that helps most of all: run skillcheck on your own skills and file [a false positive](../../issues/new?template=false-positive.md) if it flags something that's actually fine. Those get priority — a linter that cries wolf gets deleted, and it takes every other rule with it.

## License

[MIT](LICENSE)

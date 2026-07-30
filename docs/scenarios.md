# The scenarios file

`skillcheck.scenarios.yaml` is a checked-in list of requests and what should happen to each one. `skillcheck test` runs them and fails the build when the answer changes.

This file lives in *your* repository, so its shape is a contract. See [Compatibility](#compatibility) for what that commits us to.

```yaml
version: 1

scenarios:
  - prompt: "save this document as a pdf"
    expect: pdf-export
    forbid: pdf-delete

  - prompt: "what time is it in Tokyo"
    expect: none
```

Run it:

```sh
npx skillcheck test              # discovers skillcheck.scenarios.yaml
npx skillcheck test --scenarios path/to/other.yaml
```

Exit `0` when every scenario passes, `1` when any fails, `2` when the file itself is malformed.

Every run also reports **assertion coverage**: how many distinct scanned skill names appear in at least one `expect` or `forbid`. Terminal output shows up to 12 names that do not; Markdown and GitHub output show up to 20, then count the rest. JSON includes the complete lists. Scenarios address skills by name, so two files declaring the same name are one addressable target for this metric, not two independently assertable skills. Coverage is informational, not another pass/fail threshold. An `expect: none` scenario protects the corpus boundary without naming one skill, and that remains useful even though it does not increase this direct-coverage count.

## Top level

Either a mapping with a `scenarios:` list, or a bare list. Both parse; the mapping form is preferred because it has somewhere to put `version`.

| Key | | Meaning |
| --- | --- | --- |
| `version` | optional | Format version this file is written for. Absent means `1`. |
| `scenarios` | required | The list of scenarios. |

## A scenario

| Key | | Meaning |
| --- | --- | --- |
| `prompt` | required | A request a user would actually type. |
| `expect` | | The skill that should take it — a name, a list of acceptable names, or `none`. |
| `forbid` | | A skill, or list of skills, that must not take it. |

At least one of `expect` / `forbid` is required. A scenario that asserts nothing is an error, not a no-op — a line that silently tests nothing is the one thing a regression suite must never contain. Unknown keys are rejected for the same reason: `expct:` costs you a build rather than an assertion that quietly never runs.

### `expect: <name>`

The ordinary case. This skill should rank first.

```yaml
  - prompt: "turn this markdown into a printable pdf report"
    expect: pdf-report
```

### `expect: [<name>, <name>]`

Any of them winning is fine. The honest assertion when two skills genuinely overlap for a request and what you actually care about is that some *third* skill doesn't take it.

```yaml
  - prompt: "clean up this data file"
    expect: [csv-tidy, json-tidy]
```

### `expect: none`

Nothing should claim this request. The check that stops a broad skill from swallowing everything — write one for a request that is plainly outside your repo's scope.

```yaml
  - prompt: "what time is it in Tokyo"
    expect: none
```

`none` can't be combined with a skill name; it means *nothing fires*.

### `forbid: <name>`

Whatever wins, it must not be this one.

```yaml
  - prompt: "get rid of that pdf"
    forbid: pdf-archive
```

`forbid` is the assertion that scales. Past a handful of skills, `expect` over-specifies: it pins an exact winner, so an unrelated edit somewhere else fails a scenario that was never really about that. `forbid` states the thing you actually mean — *the destructive one never takes this* — and keeps holding as the repo grows.

It is also the natural fit for the case where being wrong is expensive: a skill that deletes, deploys, or sends. You don't need to know which skill handles a request to know which one must not.

Both keys can appear on one scenario:

```yaml
  - prompt: "save this document as a pdf"
    expect: pdf-export
    forbid: pdf-delete
```

## Results

| Status | | Meaning |
| --- | --- | --- |
| `pass` | ✔ | Every assertion held, with room to spare. |
| `close` | ⚠ | It holds today, by a margin too thin to depend on. Reported, not fatal. |
| `fail` | ✖ | An assertion broke. Exit code 1. |

`close` exists because a scenario that passes by 2% is not really passing — the same near-tie that `skillcheck why` reports as a coin flip. Two things produce it:

- the expected skill wins by less than 15% of its score, or
- a **forbidden** skill trails the winner by less than 15%.

That second one matters. "Must not win" alone would be too weak a reading: a forbidden skill sitting a hair behind the winner is one wording tweak away from taking the request, and reporting that is the entire point of the tool.

### CI and machine output

- `--format github` emits an error annotation for each failed contract, a warning annotation for each close result, and names up to 20 skill names with no direct assertion before counting the rest.
- `--format markdown` renders the trigger-contract table used by `--summary` in a GitHub job summary.
- `--format json` includes the full `asserted` and `unasserted` skill lists under `coverage`, additively within the version 2 output envelope.

### Names must exist

Every name in `expect` or `forbid` has to match a skill in the scanned paths. A missing one fails the scenario rather than passing quietly.

This is deliberate for `forbid`, where it's least obvious: "must not fire" is trivially true of a skill that isn't there. If someone renames or deletes the skill you were guarding against, the guard evaporates and the scenario keeps showing green — an assertion that stopped testing anything without telling you. So it fails, and the message says to fix the name or drop the line.

## Compatibility

The `version` field exists so a scenarios file can outlive the skillcheck that wrote it.

- **Absent** means version 1. Files written before `version` existed keep working, unchanged, forever.
- A file declaring a version **newer** than the running skillcheck is **refused**, with an upgrade hint. It is not parsed on a best-effort basis: a newer file may carry assertions this binary would skip, and a skipped assertion is worse than a failed run.
- Within a version, new *optional* keys may be added. Anything that would change the meaning of an existing file gets a new version number.

The current format version is **1**.

`skillcheck test --format json` reports its own separate `version` for the result envelope — that's the shape of the *output*, for tools consuming it, and is independent of the file format version.

## What a passing run does and doesn't mean

Scoring is lexical and offline (BM25 over each skill's name and description). A scenario is a regression test over the text that decides selection, not a prediction of what a model will do — which is exactly what makes it useful in CI, because it changes when and only when *you* change that text.

Read [How the trigger simulation works](trigger-simulation.md) before you trust a green run. The short version: a passing scenario means nothing in your wording is working against you. It does not mean the skill will fire.

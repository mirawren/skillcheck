# Working on skillcheck

skillcheck tells people whether the instructions they wrote for an agent will
actually be read. This file is that, for this repository — and it is checked by
`npm run selfcheck` like everything else here.

## Commands

- `npm run check` — everything CI runs. Do this before opening a pull request.
- `npm test` — the suite alone; it takes about four seconds.
- `npm run docs` — regenerate `docs/rules.md` after changing a rule. Committing
  the result is required; CI fails on drift.
- `npm run docs:examples` — rewrite the console blocks in the docs from real
  output, after changing anything a documented example prints.
- `npm run selfcheck` — skillcheck against its own skills and this file.

## What belongs here

Every rule names a failure that is **silent at runtime**: the skill won't load,
won't trigger, wastes tokens on every activation, or points the model at a file
that isn't there. A check that cannot name the failure does not ship, however
tidy the thing it objects to.

A false positive is worse than a miss. A linter that flags a correct file gets
switched off, and it takes every other rule with it — so when the evidence is
thin, report nothing. `tests/false-positives.test.ts` is the record of the times
this went wrong; add to it rather than trusting the reasoning twice.

## Conventions

Comments explain **why**, not what. The signature already says what. Most
non-obvious code here exists because something failed in a specific way, and
that story is the comment worth writing.

Findings are addressed to somebody who did not read the source. Name the file,
the words, and the consequence — a percentage and a filename is not a finding.

No new runtime dependencies. Two is the budget, there is no postinstall, and
that is a promise on the README about what runs on a fork's pull request.

Determinism is the product. No clocks, no network, no locale-dependent sorting
in anything that reaches output.

## Adding a language

One self-contained file of pure data under `src/languages/`, plus its entry in
that directory's index. Nothing else, and no changes to the tokenizer. The
contract tests enforce the shape, so a reviewer who does not read the language
can still merge it — see [CONTRIBUTING.md](CONTRIBUTING.md#add-your-language).

## Adding a rule

A rule file under `src/rules/`, an entry in `src/rules/index.ts`, tests in
`tests/rules.test.ts`, then `npm run docs`. Most are under 100 lines including
the tests. [docs/GOOD_FIRST_RULES.md](docs/GOOD_FIRST_RULES.md) is the backlog.

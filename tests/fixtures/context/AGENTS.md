# Working in this repository

A plausible AGENTS.md for a small TypeScript service, with three deliberate
defects at the end — a dead `@import`, a dead link, and a leftover marker. Those
are the three findings the README's documented output shows.

## Layout

- `src/` — the service. One module per bounded context, no barrel files.
- `src/db/` — migrations and query builders. Never import from here outside a
  repository class.
- `test/` — integration tests. Unit tests live next to the code they cover.
- `dist/` — generated. Never edit it by hand; the next build overwrites it.

## Commands

- `npm run build` — type-check and emit to `dist/`.
- `npm test` — the full suite. It is fast; run it before every commit.
- `npm run test:watch` — while working on one module.
- `npm run migrate -- --dry-run` — always dry-run a migration first.

## Conventions

Prefer explicit names over abbreviations. A reader who has never seen this file
should be able to follow a function without a glossary.

Every exported function gets a doc comment saying what it is for, not what it
does — the signature already says what it does.

Errors carry the input that caused them. An error message a person cannot act
on is a missing feature, not a logging problem.

Do not add a dependency to save fewer than about thirty lines. Each one is a
supply-chain surface and an upgrade obligation that outlives whoever added it.

Keep functions under a screen. When one grows past that, the usual cause is two
responsibilities sharing a scope, and splitting it is easier than it looks.

## Tests

Write the test that would have caught the bug, then fix the bug. A fix with no
regression test is an invitation to make the same mistake again next quarter.

Integration tests use the seeded fixture database. They must be order
independent: the suite runs in parallel and the order changes between machines.

Never assert on wall-clock time. Inject a clock; the CI runners are slower than
your laptop and the flake lands on somebody else's pull request.

## Migrations

Migrations are append-only. To change a shipped one, write a new migration that
corrects it — editing history breaks every environment that already ran it.

Every migration needs a tested rollback. "We will never roll this back" has been
wrong often enough to be a rule.

## Review

Small pull requests. A change nobody can hold in their head gets approved on
trust, which is not review.

Explain the why in the description and the what in the code. If the code needs
the description to be understood, the code is not finished.

## Further reading

Read @docs/conventions.md before you touch the client.

Architecture notes: [docs/architecture.md](docs/architecture.md).

TODO: write down the staging deploy steps

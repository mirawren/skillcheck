<!-- Thanks for contributing. Delete any section that doesn't apply. -->

## What this changes

## Why

<!-- For a new or changed rule: what failure mode does this catch? Link the
     issue, spec line, or war story that shows a skill actually breaking this
     way. "Preference" isn't enough — that's what keeps skillcheck runnable on
     every PR without people muting it. -->

## False positives

<!-- For a rule: what valid skill might this flag, and why is that acceptable?
     Answering "none, because…" is a fine answer — but answer it. -->

## Checklist

- [ ] `npm run check` passes (build, typecheck, tests, docs freshness)
- [ ] New rule: registered in `src/rules/index.ts`, has `docs.why` plus bad/good examples
- [ ] New rule: at least one test that accepts and one that rejects
- [ ] Ran `npm run docs` if rules or their metadata changed
- [ ] Behaviour change: README / docs updated

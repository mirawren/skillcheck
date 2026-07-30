---
name: skill-activation-review
description: Checks whether the agent skills in a repository would actually be selected — a description with no trigger, two skills competing for one request, a skill made unreachable by a broader sibling, or a change that moved a request from one skill to another. Use when the user asks why a skill is not firing, is writing or reviewing a SKILL.md, adds a skill next to existing ones, or wants their skills checked before a release.
license: MIT
---

# Reviewing whether a skill would actually fire

A skill's `description` is the only text a model reads before deciding whether to
load it. When it is wrong, nothing errors — the skill just doesn't get picked. Use
`skillcheck` to see that decision instead of guessing at it.

## Start here

```sh
npx skillcheck .        # every SKILL.md and plugin manifest under this path
```

Read the findings top to bottom. Errors are things that break selection; warnings
are things that make it unreliable. `npx skillcheck explain <rule>` gives the
reasoning and a corrected example for any of them.

## Answering "why didn't my skill fire?"

Rank the skills against the request the user actually typed — not the words in the
description:

```sh
npx skillcheck why "the request in the user's own words"
```

Three outcomes matter:

- **clear** — nothing in the wording is working against this skill. It is not a
  promise that the model will pick it.
- **coin flip** — two or more skills are within a hair of each other. The output
  names the terms they tie on and the terms each one holds alone. A contender with
  *nothing* of its own cannot be separated by rewording; one of those skills
  should be narrowed or removed.
- **no skill covers this** — the request shares almost no vocabulary with any
  description. Check whether the words the user used appear anywhere in them.

## Before merging a change to any description

```sh
npx skillcheck diff main
```

This is the check that has no substitute: it reports requests that changed hands
between skills the author was **not** editing. That outcome is invisible in a
normal diff, because it isn't written in either file — it only exists in the
comparison.

## Writing a description that triggers

State the capability *and* the situations that should reach it. The trigger half
is the part authors leave out:

- weak: `Provides comprehensive PDF manipulation utilities.`
- strong: `Manipulates PDF files — extract text, fill forms, merge documents. Use
  when the user asks to read, edit, split or combine a PDF.`

Then give each skill vocabulary its siblings do not claim. Two skills that
describe the same situation in different words will be chosen between
arbitrarily, and no amount of emphasis fixes that.

## Locking a fix in place

Write the request down as a scenario so the next change cannot undo it:

```yaml
# skillcheck.scenarios.yaml
version: 1
scenarios:
  - prompt: "the request that was going to the wrong skill"
    expect: the-skill-that-should-take-it
  - prompt: "a request that must never reach the destructive one"
    forbid: the-destructive-skill
```

`npx skillcheck test` then fails the build if that answer ever changes. Prefer
`forbid` once a repo has more than a handful of skills: pinning an exact winner
over-specifies and breaks on unrelated edits.

## What this cannot tell you

The ranking is lexical — a deterministic model of the retrieval step, not a
prediction of what the model will choose. Report a near-tie as a real risk and a
clear win as "nothing in the wording is working against you". Never tell the user
a skill is guaranteed to fire.

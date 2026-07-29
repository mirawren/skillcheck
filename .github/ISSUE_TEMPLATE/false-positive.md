---
name: False positive
about: skillcheck flagged something that is actually fine
title: "false positive: "
labels: false-positive
---

<!-- These get priority. A linter that cries wolf gets deleted, and it takes
     every other rule with it — so a well-reported false positive is one of the
     most valuable things you can send. -->

## The rule

<!-- e.g. when-to-use -->

## The SKILL.md it flagged

```markdown
---
name: example
description: ...
---
```

## Why it's actually fine

<!-- What makes this a legitimate skill despite the finding? -->

## What skillcheck said

```
npx skillcheck ...
```

## Environment

- skillcheck version (`npx skillcheck --version`):
- Node version:
- OS:

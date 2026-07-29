---
name: Rule proposal
about: Propose a new check for a skill/plugin failure mode
title: "rule: "
labels: rule-proposal
---

## The failure mode

<!-- What actually breaks? A skill that won't load, won't trigger, triggers wrongly,
     wastes tokens, or references something dead. Link evidence if you have it
     (issue, blog post, spec line, or your own war story). -->

## Example that should FAIL

```markdown
---
name: example
description: ...
---
```

## Example that should PASS

```markdown
---
name: example
description: ...
---
```

## Suggested severity

<!-- error = skill won't work correctly · warning = works but costs something -->

## Willing to implement it?

<!-- Most rules are <100 lines including tests — see CONTRIBUTING.md. Yes/no is fine. -->

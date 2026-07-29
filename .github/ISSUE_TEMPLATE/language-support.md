---
name: Language support
about: Ask for a language skillcheck doesn't read yet, or report one it reads wrongly
title: "lang: "
labels: language
---

<!-- Two different things use this template. Fill in whichever applies and delete
     the other. Both are welcome, and neither needs you to write any code. -->

## Which language?

<!-- Name it in English and in your own language, plus its code if you know it
     (the BCP-47 primary subtag: `bn`, `ta`, `sw`). Run `skillcheck languages`
     to see what's already supported. -->

---

## A) It isn't supported yet

**A description in your language that DOES say when to use the skill**

<!-- Write it the way you would really write one: what it does, and when to
     reach for it. This is the example the test suite will hold the pack to. -->

```
description:
```

**A description that only states a capability**

<!-- The same skill, described in the way that should be *reported* — it says
     what it can do but never when it applies. -->

```
description:
```

**How do you normally write "use this when…"?**

<!-- Two or three ordinary phrasings. This is the part no dictionary can supply
     and the single most useful thing in this issue. -->

---

## B) It's supported, but skillcheck got it wrong

**What happened**

<!-- e.g. "read my Ukrainian description as Russian", "reported when-to-use on a
     description that clearly states its trigger", "dropped a word that carries
     the meaning". -->

**The description involved**

```
description:
```

**Output**

<!-- Paste `skillcheck languages <path>` and, if relevant,
     `skillcheck why "<a request in your language>" <path>`. -->

```

```

---

**Would you like to write the pack yourself?** Yes/no — both fine. It's one
self-contained file with no dependencies, and
[CONTRIBUTING.md](../../CONTRIBUTING.md#add-your-language) walks through it. If
not, this issue is still exactly what's needed: the phrasings above are the part
that can't be looked up.

# How the trigger simulation works — and what it can't tell you

`skillcheck why` and `skillcheck test` model the step where a host decides which skill to load. This page describes exactly how, so you can judge the output rather than trust it.

## The thing being modelled

A host shows the model a list of installed skills — for each one, its `name` and `description`, and nothing else. The body of a `SKILL.md` isn't in that list; it's loaded only *after* a skill is chosen. So the decision to fire a skill is made entirely from one or two sentences you wrote.

That's the step skillcheck simulates. It cannot run a model in CI — that would need credentials, cost money per run, and produce a different answer on Tuesday — so it runs the *retrieval* half of the decision instead: a standard ranking function over that same text.

## The algorithm

**Tokenizing** (`src/text.ts`). Lowercase, split on anything that isn't a letter or digit, drop stopwords, stem. The stopword list includes the trigger vocabulary itself — `use`, `when`, `skill`, `user` — because those words appear in every well-written description, so keeping them would make every skill look like every other one. The stemmer is a trimmed Porter step 1: plurals, `-ing`, `-ed`, with the `at|bl|iz → -e` restoration and doubled-consonant collapse. It's approximate on purpose ("writing" and "write" don't fold together), and both your request and your description go through the identical function, so the approximation is symmetric.

**Indexing** (`src/match.ts`). Each skill becomes a bag of weighted terms: its `name` counted twice (a host shows it to the model too), its `description` once, plus `when_to_use` if present. Bodies are excluded — they aren't part of the decision.

**Scoring.** BM25 with the usual constants (`k1 = 1.2`, `b = 0.75`), with one deliberate choice: the IDF variant is Lucene's `log(1 + (N − df + 0.5) / (df + 0.5))`, not the textbook one. The textbook formula goes negative for a term present in more than half the corpus — and most repos hold two to five skills, where that's *every shared word*. It would silently zero out the only signal available. The Lucene variant stays positive at any `N`.

**The verdict.** Three outcomes:

| Verdict | Meaning |
| --- | --- |
| `clear` | One skill leads the runner-up by more than 15% of its score |
| `close` | The top two are within 15% — a coin flip |
| `none` | The best match caught less than a third of the request's content terms |

## What transfers to a real model, and what doesn't

**Ambiguity transfers.** If two descriptions score within a hair of each other on a request, it's because they're built from nearly the same words about nearly the same situation. No selection strategy — lexical, neural, or human — reliably resolves that the way you intended. A `close` verdict is a real finding.

**Regression transfers.** The ranking is a pure function of your text. If a scenario that passed yesterday fails today, the text that decides selection changed. That's worth a review, and it's the entire argument for `skillcheck test`: it's a diff on the input to a decision you can't otherwise see.

**Absolute ranking does not transfer.** A model reads meaning. It knows a request to "pull data out of this statement" is about PDFs even when your description says "document"; BM25 sees no shared word at all. So:

> A `clear` verdict means *nothing in your wording is working against you*. It does not mean the skill will fire.

The inverse is likewise limited: `none` means your description shares almost no vocabulary with the request, which is a genuine warning sign, but a model may still make the leap.

**Nothing about the rest of the system transfers.** How many skills are installed, what else is in the context window, what the user said three turns ago, which model is running, how the host formats the skill list — none of that is visible here, and all of it affects the outcome.

## Why lexical at all, then?

Because it's the half you can check on every pull request, for free, on someone else's machine, with the same answer every time. The failures it catches — a description with no trigger, two skills competing for one phrase, a specific skill buried under a catch-all — are real, common, and invisible until a user hits them.

A model-in-the-loop check (`skillcheck eval`, on the roadmap) answers the question this one can't: *did the skill actually fire?* That check needs credentials, costs tokens, and is non-deterministic — so it belongs on a schedule or before a release, not on every PR. The two are complementary, and neither replaces the other.

## Reading the output

```
$ skillcheck why "review my code changes before I commit"

request  review my code changes before I commit
terms    review, code, change, commit

  1.  review-me  ███████████░░░░░░░░░  54%  review code change commit
  2.  grill-me   █████████░░░░░░░░░░░  46%  review code change commit

  ⚠ coin flip — review-me leads grill-me by only 14%
```

- **terms** — what's left of your request after stopwords and stemming. If a word you consider important isn't here, it isn't influencing anything.
- **the percentage** — that skill's share of all matched score. It's a comparison *within this request*, not a probability and not a score you can compare across repos.
- **the trailing words** — which request terms that skill matched. A skill matching every term and still losing means it's diluted: its description contains a lot of other vocabulary.

The most useful habit: run `why` with the words a real user would type, not the words in your description. The gap between those two is where skills go to die.

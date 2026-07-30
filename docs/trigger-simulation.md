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
| `clear` | One skill leads every other by more than 15% of its score |
| `close` | Two or more skills sit within 15% of the leader — a coin flip |
| `none` | Nothing matched, or the winner took less than a third of the request's *matchable* terms |

**Coverage is measured over matchable terms**, meaning the request terms that occur in at least one skill in the repo. This matters more than it sounds. A real request is mostly words no description will ever contain — "help me", "set up", "quickly", "again". Counting those against the winner made coverage a measure of how conversationally the question was asked: ask *"help me set up a new webhook"* of a repo whose webhook skill is the only candidate and holds 100% of the score, and `help`, `set` and `new` outvoted the one word that decided the ranking. The verdict came back `none`, and `skillcheck test` failed the build with "nothing matched the request" — about the skill that was plainly the answer. The more naturally a request was phrased, the likelier that was.

The honest cost of the fix is that a winner can now look confident on thin evidence, so the evidence is printed rather than hidden:

```
  ✔ clear — stripe-webhooks wins (only candidate)
    matched 1 of 4 terms — help, set, new occur in no skill here
```

Read that as "one word carried this". It is not the same claim as a request whose every term landed.

**A coin flip is the whole contender block, not the top two.** `margin` compares first place to second, which is the right question when two skills collide and the wrong one when five do — a ten-way tie would otherwise report a 0% gap between the arbitrary two that sorted highest and say nothing about the other eight. `close` fires when *any* skill sits within 15% of the leader, and the output names how many.

On a `close` verdict the terms behind it are printed too:

```
  ⚠ coin flip — review-me leads grill-me by only 14%
    they tie on: bug, case, change, code, commit, edge
    only review-me: problem, repository
    only grill-me: issue, repo
```

Both lines are facts about text you wrote, not advice. The shared terms are why the tie exists. A contender whose "only" list is **empty** is the important case: every word it has belongs to a rival too, so no rewording will separate them and one of the two skills should not exist.

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

## Comparing two revisions

`skillcheck diff <ref>` runs the same ranking twice — once over the corpus as it is, once over the corpus as it was at `ref` — and reports every request whose answer moved.

The requests have to be *identical* on both sides, or the comparison would confound "the corpus changed" with "the question changed". Two sources satisfy that:

1. **Your scenarios file**, if you keep one. The sharpest probes there are: a human wrote them in the words a user would use, together with what is allowed (`expect`) or forbidden (`forbid`).
2. **Each skill's own description**, taken from both revisions. A description is the most precise available statement of what a skill claims, so it doubles as the request it should most obviously win. When a description was edited, both wordings become probes, which asks two genuinely different questions: do the requests this skill *used to* claim still reach it, and does something else already own the ones it claims now?

Description probes come only from skills present at both revisions. An added skill's own words would trivially "change hands" to it and a removed one's would trivially leave — reporting either as drift would bury the real findings under the consequences of the change you are describing in the PR title.

For description probes, drift still makes no quality judgement: it reports that an answer changed because the decisive text changed. Scenario probes are stronger because they carry a checked-in contract. `diff` runs the same assertion against both revisions, so it fails only when a contract that passed before now fails. A repaired contract or a move between winners allowed by `expect: [a, b]` / `forbid` is reported and stays green. A contract added, edited, or removed in the same change is not compared because no identical assertion exists on both sides; the report names it explicitly. `skillcheck test` checks current assertions, while removals remain visible for review.

`skillcheck diff --format json` uses a version 2 envelope. Scenario drifts include normalized `expect` and `forbid` fields under `contract`, and assertions that could not be compared appear under `scenarioContracts.skipped` with their before and after forms.

A malformed scenarios file on either revision makes `diff` exit `2`. Falling back to description probes would silently drop the stronger checked-in contracts and make a clean result ambiguous.

Four outcomes fail a build: a stable scenario contract regressed, a description request changed hands between skills the change did not edit, a request stopped reaching anything, or a new error was introduced. Narrowing leads, repairs, allowed movement, intended description drift, and added skills remain informational.

Reading the historical revision goes through `git ls-tree` and `git cat-file`, which read the local object database. Nothing is fetched, checked out or stashed, and the working tree is never modified. A ref that is not present locally — the usual cause being a shallow CI clone — is an error naming `fetch-depth: 0`, not a network call.

## Reading the output

<!-- verify: why "review my code changes before I commit" . cwd=tests/fixtures/bad exit=0 -->

```console
$ skillcheck why "review my code changes before I commit"

request  review my code changes before I commit
terms    review, code, change, commit

  1.  review-me  ███████████░░░░░░░░░  54%  review code change commit
  2.  grill-me   █████████░░░░░░░░░░░  46%  review code change commit

  ⚠ coin flip — review-me leads grill-me by only 14%
    their descriptions tie on: bug, case, change, code, commit, edge
    only review-me: problem, repository
    only grill-me: issue, repo

  BM25 over each skill's name + description. A deterministic model of the retrieval
  step, not a prediction of the model's choice — read a near-tie as a real risk and a
  clear win as "nothing in your wording is working against you".
```

- **terms** — what's left of your request after stopwords and stemming. If a word you consider important isn't here, it isn't influencing anything.
- **the percentage** — that skill's share of all matched score. It's a comparison *within this request*, not a probability and not a score you can compare across repos.
- **the trailing words** — which request terms that skill matched. A skill matching every term and still losing means it's diluted: its description contains a lot of other vocabulary.

The most useful habit: run `why` with the words a real user would type, not the words in your description. The gap between those two is where skills go to die.

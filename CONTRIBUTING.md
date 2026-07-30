# Contributing to skillcheck

Thanks for helping make agent skills less of a coin flip. The project is built so that **a useful contribution fits in one small PR** — most rules are under 100 lines including their tests.

## Ground rules for new checks

Every rule must tie to a **documented failure mode** — a way a skill actually breaks: won't load, won't trigger, triggers on the wrong requests, wastes tokens, or points at something that doesn't exist. "I prefer it this way" is not a rule; link the issue, blog post, or spec line that shows the failure. This is what keeps skillcheck trustworthy enough to run on every PR.

Rules must stay **deterministic and offline**. No network, no model calls, no randomness — CI runs must be reproducible with zero credentials, on someone else's machine, a year from now.

**False positives are worse than misses.** A linter that cries wolf gets deleted, and it takes every rule with it. When a heuristic is uncertain, prefer `warning`, and say in the message what made it uncertain.

## Adding a rule in 15 minutes

1. **Create `src/rules/your-rule.ts`** exporting a `Rule`:

   ```ts
   import type { Rule } from "../types.js";

   export const yourRule: Rule = {
     id: "your-rule",
     summary: "one line: what this catches",
     docs: {
       why: "The concrete failure this prevents, in two sentences. No hedging.",
       bad: "description: the smallest example that trips the rule",
       good: "description: the same example, corrected",
     },
     check(doc, ctx) {
       // doc: one parsed SKILL.md (frontmatter, body, raw text, paths)
       // ctx.skills: every discovered skill, for cross-skill rules
       // ctx.options[this.id]: user config for this rule (see below)
       return [];
     },
   };
   ```

   `docs` is required, and it earns its keep: it's what `skillcheck explain your-rule` prints, what [docs/rules.md](docs/rules.md) is generated from, and what GitHub's Security tab shows under each alert. Write it once, it lands everywhere — and it can't drift, because `npm run docs:check` fails CI if the committed reference doesn't match the code.

   If your rule has a threshold, make it configurable rather than hard-coded, and declare it so it lands in the docs:

   ```ts
   import { numberOption } from "../config.js";

   options: [{ name: "max", type: "number", default: 500, description: "Lines allowed before warning." }],
   // …then inside check():
   const max = numberOption(ctx.options[this.id], "max", 500);
   ```

   Disabling and severity overrides are wired centrally — you don't handle them in the rule.

2. **Register it** in `src/rules/index.ts` (order = the order it appears in the docs).
3. **Test it** in `tests/rules.test.ts` — at least one accepting case and one rejecting case. `tests/helpers.ts` has `tmpRepo()` and `skillMd()` for realistic multi-skill input.
4. **Regenerate the reference**: `npm run docs`.
5. Run `npm run check` and open the PR, explaining the failure mode (with a link if you have one).

### Optional: make it fixable

If some of the rule's findings can be repaired mechanically and unambiguously, add a `fix`:

```ts
fixable: true,
fix(doc) {
  // Return non-overlapping TextEdits into doc.raw. Return [] when unsure.
  return [{ start, end, text }];
},
```

The engine re-parses and re-runs after each pass, so a fixer may repair one thing per pass. Only **safe** fixes belong here: no semantic guesswork, and never anything that could destroy an author's content. `name-format` normalizes an invalid name but deliberately won't rename a folder; `unknown-keys` renames a typo'd key but refuses when the real key already exists. When in doubt, leave it to the human.

### Optional: run it over AGENTS.md too

A rule about a *body* often applies just as well to a context file, where the same defect is read at the start of every session instead of on activation. Those live in `src/context.ts` as a `ContextRule` — the same shape minus the fixer, because mechanically rewriting somebody's hand-written instructions is not this tool's business.

Reuse the skill-side rule id when it is the same defect with the same fix, and put the shared detection in `src/scan.ts` so the two can't drift apart. `broken-references` and `no-placeholders` both work that way: one id, one documented rule, two document kinds — and switching the rule off switches off all of it, which is what a reader expects `"off"` to mean. Give it a new id only when the failure is genuinely different, as `context-size` is: it budgets a cost paid unconditionally, where `body-size` budgets one paid on activation.

## Add your language

**This is the most valuable contribution nobody else can make for you.**

skillcheck reads [24 languages](docs/languages.md). Adding the next one is a
single self-contained file — no dependencies, no changes to the tokenizer or the
detector, and no need to read the rest of the codebase. If you write skills in a
language that isn't on the list, you are the only person who can do this
correctly, and it takes about an hour.

A language pack is pure data:

```ts
// src/languages/xx.ts
import type { LanguagePack } from "./types.js";

export const xx: LanguagePack = {
  code: "xx",              // BCP-47 primary subtag — what users write in x-skillcheck.lang
  name: "Yourlang",        // in English
  endonym: "Yourlang",     // in your language, as you would write it
  scripts: ["latin"],      // see src/script.ts for the list

  stopwords: [/* … */],
  triggerSignals: [/* … */],
  firstPerson: [/* optional */],

  samples: { triggers: [/* … */], capabilityOnly: [/* … */] },
};
```

Then add it to `LANGUAGES` in `src/languages/index.ts` (alphabetical by code) and
run `npm run docs`. That's the whole change. If your language is written in a
script no pack claims yet, it becomes that script's answer automatically — the
detector reads the registry, so there is nothing to edit there.

### The four fields, and how to get them right

**`stopwords`** — function words with no power to distinguish one skill from
another: articles, pronouns, prepositions, auxiliaries, conjunctions. Aim for the
closed class and stop.

> The most damaging mistake a pack can make is listing a **content** word.
> Every skill whose description uses it becomes unfindable by requests that
> mention it. When unsure, leave it out — a missing stopword costs a little
> ranking precision; a wrong one costs a skill.

Write them **folded**: lowercase and in the form `fold()` produces. That usually
means unaccented (`despues`, not `después`), but it is script-specific — Greek
also folds final `ς` to `σ`, Arabic collapses the alef variants, and the Brahmic
scripts keep their vowel signs. Don't guess:

```sh
npm run build
node -e "import('./dist/script.js').then(m => console.log(m.fold('YOUR WORD')))"
```

The test suite checks this for you and prints the correct form when you're wrong.

**`triggerSignals`** — the phrasings that prove a description says *when* the
skill applies, not only what it does. This is what makes `when-to-use`,
skillcheck's flagship rule, work in your language.

Be **conservative**: a missing pattern costs a false error on a skill that was
fine, so when a phrasing is arguable, include it. But watch the other direction
too — a pattern loose enough to match any description switches the rule off for
your whole language, and the test suite will catch that.

Two traps, both of which have already shipped bugs here:

- **`\b` does not work outside ASCII.** JavaScript defines it on `[A-Za-z0-9_]`,
  so `जब भी\b` and `(للحالات)\b` never match anything. Write
  `(?![\p{L}\p{M}])` with the `u` flag instead.
- **Watch for words that start with other words.** Hindi `उपयोग` ("use") opens
  `उपयोगकर्ता` ("user") and `उपयोगिताओं` ("utilities"); Bengali `ব্যবহার` opens
  `ব্যবহারকারী`. Without an explicit end-of-word, "a collection of utilities
  for…" reads as "use for…" and the rule stops firing.

**`firstPerson`** — optional. Assistant-voice phrasings ("I can help you…") that
`description-third-person` reports. Omit it entirely if your language's
politeness system makes the distinction unclear; a pack with no entry simply
never raises that rule, which is the correct default.

**`samples`** — required, and the reason a reviewer who doesn't read your
language can still merge your PR with confidence. Write them the way a native
speaker actually writes a description — two clauses, what it does and when to
reach for it — not as minimal strings that happen to match your patterns.

`tests/languages.test.ts` runs every pack through the same contract:

- each `triggers` sample must be detected as your language **and** pass `when-to-use`;
- each `capabilityOnly` sample must be detected as your language **and** still be reported;
- no sample may be mistaken for another language's;
- stopwords must be folded, unique, and leave real terms behind;
- no `\b` may sit where it cannot fire.

Nothing is exempt, so a pattern that never fires cannot ship quietly, and a later
change to the tokenizer cannot silently break a language nobody else here reads.

### Try it before you open the PR

```sh
npm run build
npm test                                      # the contract, for every pack
node dist/bin.js languages path/to/your/skills   # what was detected, and where it was unsure
node dist/bin.js why "<a request in your language>" path/to/your/skills
```

If detection reads your language as something else, that's a bug worth reporting
on its own — open an issue with the description that was misread.

## Writing good findings

- `message`: what is wrong, in one sentence, naming the offending value.
- `detail`: why it matters and how to fix it — for someone who has never read the spec.
- Severity: `error` = the skill will not work correctly for someone; `warning` = it works but costs something (tokens, ambiguity, maintainability).

## Project layout

| Path | What lives there |
| --- | --- |
| `src/rules/` | One file per rule. Start here. |
| `src/context.ts` | `AGENTS.md` / `CLAUDE.md` as a document kind, and the short rule list that runs over it. |
| `src/scan.ts` | Body scanners both document kinds share — dead references, leftover placeholders. |
| `src/budget.ts` | What the repo's instructions occupy before anyone asks for anything (`skillcheck budget`). |
| `src/match.ts` | The trigger simulation: BM25 over name + description, shared by `why`, `test`, and the cross-skill rules. |
| `src/text.ts` | Tokenizing, stopwords, stemming — the shared vocabulary layer. |
| `src/script.ts` | Unicode script classification, folding and terminal width. The layer that lets every check work outside English. |
| `src/languages/` | One file per language: stopwords, trigger phrasings, worked samples. **Pure data — start here to add yours.** |
| `src/fix.ts` | The multi-pass autofix engine (edits are pure; the CLI does the writing). |
| `src/baseline.ts` | Accepting pre-existing findings so an established repo can adopt the tool today. |
| `src/report.ts` | Every output format: pretty, github, json, sarif, markdown, junit, badge. |
| `src/cli.ts` | Argument parsing and commands. `runCli(argv, io)` returns an exit code — no `process.exit`, so it's testable in-process. |

## Dev setup

```sh
npm install
npm run check                       # build + typecheck + tests + docs freshness
node dist/bin.js tests/fixtures/bad # watch it complain
npm run bench                       # timings on a synthetic corpus
```

Node ≥20. No linter/formatter config — match the style of the file you're editing. Comments explain *why*, not what.

## Not sure where to start?

- **[Add your language](#add-your-language)** — one file, no dependencies, and nobody else can do it for you.
- [docs/GOOD_FIRST_RULES.md](docs/GOOD_FIRST_RULES.md) — a backlog of rules that are ready to be written, each scoped to one small PR.
- Issues labeled `good-first-rule`.
- Best of all: run skillcheck on your own skills, and file whatever it *should* have caught but didn't. A good false-negative report is worth more than a rule.

## Reporting a finding on a file that was fine

This is the highest-value bug report this project takes, and it gets priority over everything else. A linter that cries wolf gets deleted and takes every other rule with it, so a rule firing on a correct file is treated as more serious than a rule missing a broken one.

Every such fix lands as a case in [tests/false-positives.test.ts](tests/false-positives.test.ts), which is kept separate from the per-rule tests on purpose: those assert that a rule catches what it is for, while every test in that file asserts that a rule *stopped* flagging something an author wrote correctly. If you fix one, add the case there — and add the matching "still reports the real thing" assertion beside it, so the fix can't quietly switch the rule off.

For a `when-to-use` false positive specifically, add the description to your language pack's `samples.triggers`. The language contract tests then enforce it, which means a later pattern change cannot bring the finding back.

## Support for open-source contributors

Anthropic's Claude for Open Source program supports eligible individuals doing substantive open-source work. If you are considering it, use the project's [eligibility and evidence guide](docs/claude-for-oss.md) for the official criteria, an application worksheet, and the duplicate-application warning. A contribution here is welcome, but it is not an eligibility credential by itself; quality and real ecosystem impact matter more than activity counts.

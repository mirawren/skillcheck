# Skills in other languages

A skill that never triggers fails the same way in every language. The description
is still the only text the model reads before deciding; it can still describe a
capability instead of a trigger; two skills can still be worded so alike that the
choice between them is arbitrary. None of that is a property of English.

But a linter written for English doesn't merely miss those failures elsewhere —
it invents new ones. Split a Japanese description on `[^a-z0-9]+` and you are
left with two loanwords; split a Russian one and you are left with nothing. Every
check downstream then reasons about that empty set and reports, with total
confidence, something that isn't true. skillcheck's original tokenizer did
exactly this, which is the reason any of the machinery below exists.

So the rule skillcheck holds itself to is: **what it says about a description in
your language is as true as what it says about an English one, or it says
nothing at all.** Where it can't tell, it stays quiet. A wrong error about a
skill that was fine is the failure that gets a linter deleted, and it takes every
other rule with it.

## What works, and how

### Segmentation is driven by script, not language

Where words end is a property of the writing system. Latin, Cyrillic, Greek,
Hebrew, Arabic and the Brahmic scripts put spaces between words; Han, Kana,
Hangul, Thai, Lao, Khmer and Burmese do not.

A change of script also ends a word, which does real linguistic work for free.
Japanese keeps content in kanji and grammar in kana, so `PDFを作成` falls apart
into `pdf`, `を` and `作成` without anything in the pipeline knowing a word from a
particle.

Characters belonging to no script in particular — digits, combining marks — join
whatever run they land in, so `pdf2md` and `ISO8601` survive whole.

### Scripts without spaces use character bigrams

Segmenting Chinese, Japanese or Thai properly takes a dictionary. Shipping one
would cost megabytes and the offline guarantee that lets skillcheck run on a
fork's pull request with no credentials, so it uses overlapping character bigrams
instead — the same fallback Lucene's CJK analyzer has used for two decades.

`報告書` becomes `報告`, `告書`. This is an approximation, and it is worth being
precise about why it holds: **both sides of every comparison go through it.** A
request mentioning `報告` shares the bigram `報告` with that description whatever
the true word boundaries were. Retrieval works; the terms are not words.

### Normalization is script-aware, because it has to be

Accent folding is safe in Latin and Greek, where accents are decoration. It is
catastrophic in Devanagari or Bengali, where the combining marks *are* the
vowels: fold them away and `कि` becomes `क`. So `fold` strips marks only for the
scripts where they are decoration, and keeps them everywhere else.

The Arabic normalizations are the standard set every Arabic search index applies:
alef variants collapse, taa marbuta reads as haa, alef maqsura as yaa, tatweel
disappears. Greek folds final sigma onto medial sigma. CJK text is NFKC-normalized
because it is routinely typed with fullwidth Latin — `ＰＤＦ` and `PDF` have to be
one term.

### Stopwords are per-language, never merged

A single shared list cannot work. German `war` ("was") must be dropped from a
German description and kept in an English one, where it is an ordinary noun. Same
for Dutch `die` and Indonesian `dan`. So each Latin-script language gets only its
own list.

English is folded in for every **non**-Latin language, because a Japanese or
Russian description still carries its technical prose in Latin runs — "Markdown
to PDF", "when the user asks" — and English function words cannot collide with
anything in kana or Cyrillic. The reverse would not be safe, which is why it
isn't done.

### Detection reads the description

The `description` is the longest and most natural prose a skill has — a `name` is
a slug and a body is full of code — so it decides the language, and that decision
is reused for every other field.

Script shares come first, since they are decisive for most of the world's writing
systems. Where several languages share an alphabet (Russian and Ukrainian, Arabic
and Persian, and everything written in Latin), function-word frequency breaks the
tie. No model, no network.

Short, loanword-heavy descriptions are where this has least to go on. When you
know better, say so:

```yaml
---
name: pdf-report
description: マークダウンから PDF レポートを生成します。
x-skillcheck:
  lang: ja
---
```

`skillcheck languages` shows what was detected for every skill in your repo,
and flags the ones guessed on thin evidence.

## The rule that only exists in a multilingual repo

Two languages share almost no vocabulary. So a skill described only in Japanese
is not merely *outranked* by an English request — it is **unreachable** by one,
because there is no term in common to rank on.

On a team where one person writes skills in their language and another asks
questions in theirs, each half is invisible to the other, and nothing reports it.
The skill loads fine. Every other lint passes. It just never fires for half the
people who have it installed.

[`cross-language-trigger`](rules.md#cross-language-trigger) reports this, under
two conditions that keep it narrow enough to be worth having:

- **The repo must already be multilingual.** A repo written entirely in one
  language works perfectly and is nobody's business but its authors'.
- **Only non-Latin descriptions are judged** — not out of deference to English,
  but because the mechanism is asymmetric. Technical vocabulary is Latin
  everywhere, so a description already in Latin script shares terms with other
  languages by default; one in another script may share none at all.

What usually rescues it is already in the sentence. `PDF`, `Markdown`, `Excel`,
`git`, `Kubernetes` are what a request contains whatever language it is asked in,
and one of them is enough:

```yaml
# unreachable from an English request
description: マークダウンから印刷用の文書を作成します。文書の作成を依頼されたときに使用してください。

# reachable — "Markdown" and "PDF" survive translation
description: Markdown から PDF レポートを生成します。PDF の作成を依頼されたときに使用してください。
```

`skillcheck why` says the same thing from the other direction: when a request
finds nothing in a multilingual repo, it names the languages that were never in
the running, so an empty ranking reads as "asked in the wrong language" rather
than "no skill covers this".

## Supported languages

Detection, per-language stopwords, and trigger-phrase recognition for
`when-to-use`:

<!-- BEGIN:languages -->

**24 languages.**

| Code | Language | | Script | Trigger phrasings | Assistant-voice check |
| --- | --- | --- | --- | :---: | :---: |
| `ar` | Arabic | العربية | Arabic | 10 | ✅ |
| `bn` | Bengali | বাংলা | Brahmic | 10 | ✅ |
| `de` | German | Deutsch | Latin | 11 | ✅ |
| `el` | Greek | Ελληνικά | Greek | 10 | ✅ |
| `en` | English | English | Latin | 15 | ✅ |
| `es` | Spanish | Español | Latin | 14 | ✅ |
| `fa` | Persian | فارسی | Arabic | 10 | ✅ |
| `fr` | French | Français | Latin | 14 | ✅ |
| `he` | Hebrew | עברית | Hebrew | 11 | ✅ |
| `hi` | Hindi | हिन्दी | Devanagari | 10 | ✅ |
| `id` | Indonesian | Bahasa Indonesia | Latin | 7 | ✅ |
| `it` | Italian | Italiano | Latin | 12 | ✅ |
| `ja` | Japanese | 日本語 | Kana, Han | 11 | ✅ |
| `ko` | Korean | 한국어 | Hangul | 10 | ✅ |
| `nl` | Dutch | Nederlands | Latin | 9 | ✅ |
| `pl` | Polish | Polski | Latin | 10 | ✅ |
| `pt` | Portuguese | Português | Latin | 13 | ✅ |
| `ru` | Russian | Русский | Cyrillic | 12 | ✅ |
| `sw` | Swahili | Kiswahili | Latin | 10 | ✅ |
| `th` | Thai | ไทย | Thai | 11 | — |
| `tr` | Turkish | Türkçe | Latin | 9 | ✅ |
| `uk` | Ukrainian | Українська | Cyrillic | 11 | ✅ |
| `vi` | Vietnamese | Tiếng Việt | Latin | 8 | ✅ |
| `zh` | Chinese | 中文 | Han | 11 | ✅ |

`Code` is what you write in `x-skillcheck.lang`. `Trigger phrasings` counts the
patterns `when-to-use` recognizes as saying *when* a skill applies.

<!-- END:languages -->

**A language not on this list is not broken.** Its script is still classified,
so segmentation, token counting, similarity and shadowing all work. What it loses
is the checks that need to know the language: `when-to-use` and
`description-third-person` stay silent rather than guess, because a wrong error
about a well-written skill is worse than a missing one.

Bringing your language onto the list is a self-contained pull request — one file,
no dependencies, no need to read the rest of the codebase. The walkthrough is in
[CONTRIBUTING.md](../CONTRIBUTING.md#add-your-language), and the test suite
enforces the contract for you: your worked examples must be detected as your
language, the ones that state a trigger must pass `when-to-use`, and the ones
that only state a capability must still be reported.

## What this is not

- **Not translation.** skillcheck never rewrites your description, and never
  suggests you write it in English.
- **Not a language model.** Detection and ranking are lexical, deterministic and
  offline. Read a near-tie as a real risk and a clear win as "nothing in your
  wording is working against you" — never as a prediction of what a model will
  do. See [trigger-simulation.md](trigger-simulation.md).
- **Not equally good everywhere.** Bigram segmentation is coarser than real
  morphology, and a stopword list assembled by one person is coarser than one
  assembled by a native speaker. Both get better with contributions, and both
  fail toward silence rather than toward false errors.

import type { Script } from "../script.js";

/**
 * Everything skillcheck needs to know about one human language.
 *
 * A pack is deliberately small and declarative — no code, no dependencies, no
 * model — so that adding a language is a self-contained pull request a native
 * speaker can write and review without reading the rest of the codebase.
 * See CONTRIBUTING.md → "Add your language".
 */
export interface LanguagePack {
  /** BCP-47 primary subtag: `en`, `pt`, `zh`. Unique across the registry. */
  code: string;
  /** English name, for docs and `skillcheck languages`. */
  name: string;
  /** The language's own name for itself. Shown first, because it should be. */
  endonym: string;
  /** Scripts this language is written in, most common first. */
  scripts: readonly Script[];

  /**
   * Function words with no power to distinguish one skill from another.
   *
   * Written **folded** — lowercase and unaccented (`despues`, not `después`) —
   * because that is the form the tokenizer produces. Aim for the closed class:
   * articles, pronouns, prepositions, auxiliaries, conjunctions. Adding a
   * content word here makes every skill using it invisible to requests that
   * mention it, which is the most damaging mistake a pack can make.
   */
  stopwords: readonly string[];

  /**
   * Phrasings that prove a description says *when* the skill applies, not only
   * what it does. Tested against the folded description by the `when-to-use`
   * rule, which is skillcheck's flagship check.
   *
   * Two properties matter more than coverage:
   *   - **Written folded**, like the stopwords: match `usalo cuando`, not
   *     `úsalo cuando`, so a description typed without accents still passes.
   *   - **Conservative.** A missing pattern costs a false error on a skill that
   *     was fine, which is the failure that gets a linter uninstalled. When a
   *     phrasing is arguable, include it.
   */
  triggerSignals: readonly RegExp[];

  /**
   * Assistant-voice phrasings ("I can help you…") that Anthropic's authoring
   * guidance says to avoid in a description. Optional: a pack with no entry
   * simply never raises `description-third-person`, which is the correct
   * default for a language whose politeness system makes the distinction
   * unclear.
   */
  firstPerson?: readonly RegExp[];

  /**
   * Extra high-signal words for language detection, beyond the stopwords.
   *
   * Only needed where two languages share most of their function words —
   * Spanish and Portuguese, Russian and Ukrainian — and one needs a thumb on
   * the scale. Written folded.
   */
  markers?: readonly string[];

  /** Worked examples the test suite runs against this pack. Required. */
  samples: LanguageSamples;
}

/**
 * The proof a pack works, and the reason a pack can be reviewed by someone who
 * does not read the language.
 *
 * `tests/languages.test.ts` runs these for every registered pack: each
 * `triggers` description must be detected as this language and must satisfy
 * `when-to-use`; each `capabilityOnly` one must be detected as this language
 * and must be reported. That is the entire contract, and it is enforced —
 * which means a pull request adding a language cannot quietly ship patterns
 * that never fire, and a later change to the tokenizer cannot quietly break a
 * language nobody on the project speaks.
 */
export interface LanguageSamples {
  /**
   * Realistic descriptions that DO state when the skill applies. Write them the
   * way a native speaker actually writes a description — two clauses, what it
   * does and when to reach for it — not as a minimal string that happens to
   * match a pattern.
   */
  triggers: readonly string[];
  /**
   * Realistic descriptions that state only a capability. These must be reported
   * by `when-to-use`; if one of them passes, a pattern in this pack is too
   * loose and the rule has stopped catching the failure it exists for.
   */
  capabilityOnly: readonly string[];
}

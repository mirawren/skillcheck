import { fold, type Script, scriptProfile } from "../script.js";
import { ar } from "./ar.js";
import { bn } from "./bn.js";
import { de } from "./de.js";
import { el } from "./el.js";
import { en } from "./en.js";
import { es } from "./es.js";
import { fa } from "./fa.js";
import { fr } from "./fr.js";
import { he } from "./he.js";
import { hi } from "./hi.js";
import { id } from "./id.js";
import { it } from "./it.js";
import { ja } from "./ja.js";
import { ko } from "./ko.js";
import { nl } from "./nl.js";
import { pl } from "./pl.js";
import { pt } from "./pt.js";
import { ru } from "./ru.js";
import { sw } from "./sw.js";
import { th } from "./th.js";
import { tr } from "./tr.js";
import type { LanguagePack } from "./types.js";
import { uk } from "./uk.js";
import { vi } from "./vi.js";
import { zh } from "./zh.js";

export type { LanguagePack } from "./types.js";

/**
 * Every language skillcheck knows how to read, sorted by code so `skillcheck
 * languages` and the generated docs list them in a stable order.
 *
 * A language being absent here is not a failure — it means the checks that
 * depend on knowing the language stay quiet for it rather than guessing. That
 * asymmetry is deliberate: a wrong guess about a language costs a false error
 * on a skill that was fine, which is the failure that gets a linter deleted.
 */
export const LANGUAGES: readonly LanguagePack[] = [
  ar, bn, de, el, en, es, fa, fr, he, hi, id, it, ja, ko, nl, pl, pt, ru, sw, th, tr, uk, vi, zh,
];

const BY_CODE = new Map(LANGUAGES.map((pack) => [pack.code, pack]));

export function packFor(code: string): LanguagePack | undefined {
  return BY_CODE.get(code.toLowerCase().split(/[-_]/)[0]);
}

/**
 * Domain noise: true of very nearly every skill ever written, in any language,
 * so it separates nothing and is dropped everywhere. These are ASCII terms that
 * appear untranslated in descriptions the world over.
 */
export const UNIVERSAL_STOPWORDS: ReadonlySet<string> = new Set([
  "skill", "skills", "agent", "agents", "assistant", "claude", "helper",
  "tool", "tools", "llm", "ai",
]);

/** Precomputed lookup sets, built once per pack. */
const STOPWORD_SETS = new Map<string, ReadonlySet<string>>(
  LANGUAGES.map((pack) => [pack.code, new Set(pack.stopwords)]),
);

export function stopwordsOf(pack: LanguagePack): ReadonlySet<string> {
  return STOPWORD_SETS.get(pack.code) ?? new Set(pack.stopwords);
}

export interface Detection {
  /** The language pack, or null when the text is in a language with no pack. */
  pack: LanguagePack | null;
  /**
   * How strongly the evidence pointed here, 0–1. Low confidence is normal for a
   * very short description and is a reason for callers to widen, not to guess:
   * see `when-to-use`, which falls back to accepting any same-script language's
   * trigger phrasing rather than reporting an error it isn't sure about.
   */
  confidence: number;
  /** Dominant script, reported even when no pack claimed the text. */
  script: Script | null;
}

const NONE: Detection = { pack: null, confidence: 0, script: null };

/**
 * A non-Latin script has to account for this much of a text's letters before it
 * decides the language.
 *
 * Latin is everywhere — product names, file formats, code identifiers and CLI
 * flags stay ASCII in every language — so a Japanese description is routinely
 * 20-30% Latin characters. Requiring a plurality would misread it as English.
 * A fifth of the letters in one non-Latin script is not something that happens
 * by accident.
 */
const NON_LATIN_SHARE = 0.2;

/** Kana anywhere is the tell that distinguishes Japanese from Chinese. */
const KANA_SHARE = 0.03;

/** Words that decide a Latin-script language, weighted above bare stopwords. */
const MARKER_WEIGHT = 2;

/**
 * Which language a text is written in.
 *
 * Deterministic and offline like everything else here: script shares first —
 * they are decisive for most of the world's writing systems — then function-word
 * frequency to separate languages that share an alphabet. No model, no
 * `Intl.LocaleMatcher`, no network.
 */
export function detect(text: string): Detection {
  if (!text.trim()) return NONE;
  const cached = CACHE.get(text);
  if (cached) return cached;
  const result = detectUncached(text);
  if (CACHE.size >= CACHE_LIMIT) CACHE.clear();
  CACHE.set(text, result);
  return result;
}

const CACHE = new Map<string, Detection>();
const CACHE_LIMIT = 4096;

/**
 * Which packs claim each script, derived from the registry rather than written
 * out here.
 *
 * The point is that adding a language stays a self-contained pull request. A
 * pack that names a script no other pack claims becomes that script's answer
 * the moment it is registered — no edit to the detector, which is the file a
 * contributor adding Bengali or Greek has no business having to reason about.
 */
const BY_SCRIPT = (() => {
  const map = new Map<Script, LanguagePack[]>();
  for (const pack of LANGUAGES) {
    for (const script of pack.scripts) {
      const list = map.get(script);
      if (list) list.push(pack);
      else map.set(script, [pack]);
    }
  }
  return map;
})();

/**
 * Han and Kana are one bucket, decided by {@link KANA_SHARE} rather than by
 * function words: Japanese and Chinese share the Han characters outright, and
 * the presence of kana — not vocabulary — is what separates them.
 */
const CJK: ReadonlySet<Script> = new Set<Script>(["han", "kana"]);

function detectUncached(text: string): Detection {
  const folded = fold(text);
  const profile = scriptProfile(folded);
  let letters = 0;
  for (const count of profile.values()) letters += count;
  if (letters === 0) return NONE;

  const share = (script: Script) => (profile.get(script) ?? 0) / letters;

  const cjk = share("han") + share("kana");
  if (cjk >= NON_LATIN_SHARE) {
    const japanese = share("kana") >= KANA_SHARE;
    return { pack: japanese ? ja : zh, confidence: cjk, script: japanese ? "kana" : "han" };
  }

  const words = folded.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) ?? [];

  // The non-Latin script carrying most of the text decides which packs are even
  // candidates. Sorted by share so a stray character from a neighbouring block
  // — a Bengali sentence ends with a danda that Unicode files under Devanagari
  // — cannot outvote the script the text is actually written in.
  const claimed = [...BY_SCRIPT.keys()]
    .filter((script) => script !== "latin" && !CJK.has(script))
    .map((script) => ({ script, share: share(script) }))
    .filter((entry) => entry.share >= NON_LATIN_SHARE)
    .sort((a, b) => b.share - a.share || a.script.localeCompare(b.script));

  if (claimed.length > 0) {
    const { script, share: scriptShare } = claimed[0];
    const candidates = BY_SCRIPT.get(script) ?? [];
    // One pack owns the script outright: the script itself is the evidence, and
    // it is far stronger than any count of function words.
    if (candidates.length === 1) {
      return { pack: candidates[0], confidence: scriptShare, script };
    }
    // Several languages share it — Russian and Ukrainian, Arabic and Persian —
    // so the function words have to break the tie.
    const best = scoreCandidates(candidates, words);
    return { pack: best.pack ?? candidates[0], confidence: best.confidence, script };
  }

  if (share("latin") > 0) {
    const best = scoreCandidates(BY_SCRIPT.get("latin") ?? [], words);
    // No function word from any pack matched — a two-word description, or a
    // language skillcheck has no pack for. English is the honest default for
    // Latin script, but the confidence says not to lean on it.
    return { pack: best.pack ?? en, confidence: best.confidence, script: "latin" };
  }

  // A script no pack claims: Armenian, Ethiopic, Khmer… The script is still
  // known, which is enough for tokenizing and for pricing tokens honestly.
  let dominant: Script | null = null;
  let bestCount = 0;
  for (const [script, count] of [...profile].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (count > bestCount) {
      dominant = script;
      bestCount = count;
    }
  }
  return { pack: null, confidence: 0, script: dominant };
}

/** Highest-scoring pack by weighted function-word frequency; null at zero hits. */
function scoreCandidates(
  candidates: readonly LanguagePack[],
  words: readonly string[],
): { pack: LanguagePack | null; confidence: number } {
  if (words.length === 0) return { pack: null, confidence: 0 };

  let best: LanguagePack | null = null;
  let bestScore = 0;
  // Alphabetical by code, so an exact tie always resolves the same way.
  for (const pack of [...candidates].sort((a, b) => a.code.localeCompare(b.code))) {
    const stopwords = stopwordsOf(pack);
    const markers = pack.markers ? new Set(pack.markers) : null;
    let hits = 0;
    for (const word of words) {
      if (markers?.has(word)) hits += MARKER_WEIGHT;
      else if (stopwords.has(word)) hits += 1;
    }
    const score = hits / words.length;
    if (score > bestScore) {
      best = pack;
      bestScore = score;
    }
  }
  return { pack: best, confidence: Math.min(1, bestScore) };
}

/**
 * Below this, {@link detect} has picked a language on thin evidence — a
 * description of a few words, or one written entirely in terms no function-word
 * list contains. Callers that would otherwise report an error should widen
 * instead.
 */
export const LOW_CONFIDENCE = 0.15;

/** Human-readable label for a detection: `Japanese (日本語)`, or the script. */
export function describeLanguage(detection: Detection): string {
  if (detection.pack) {
    const { name, endonym } = detection.pack;
    return name === endonym ? name : `${name} (${endonym})`;
  }
  return detection.script ? `unrecognized (${detection.script} script)` : "unknown";
}

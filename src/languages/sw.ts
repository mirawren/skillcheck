import type { LanguagePack } from "./types.js";

/**
 * Swahili is written in the Latin alphabet, so it competes with every other
 * Latin pack at detection time and is decided on function words alone. The
 * noun-class agreement system is what makes that reliable: `wa`, `ya`, `za`,
 * `la`, `cha`, `kwa` are grammatical particles that appear in nearly every
 * sentence and in no other language on the list.
 *
 * Verbs carry their subject, tense and object as prefixes (`a-na-omba`, "he/she
 * is asking"), so patterns here anchor on the particles and the invariant stems
 * rather than trying to match a whole conjugated verb.
 */
export const sw: LanguagePack = {
  code: "sw",
  name: "Swahili",
  endonym: "Kiswahili",
  scripts: ["latin"],
  stopwords: [
    "na", "ya", "wa", "za", "la", "cha", "vya", "kwa", "ni", "si", "katika",
    "kutoka", "hadi", "kwenye", "au", "lakini", "kama", "ikiwa", "wakati",
    "baada", "kabla", "hii", "hiyo", "hizi", "huo", "huu", "ile", "hilo",
    "yote", "kila", "kwamba", "ambayo", "ambao", "ambaye", "yake", "yao",
    "zake", "moja", "pia", "sana", "ili", "hivyo", "basi", "tena", "bado",
    "wote", "chake", "lake", "juu", "chini", "pamoja", "kisha",
    // Domain noise: true of nearly every skill written in Swahili.
    "tumia", "kutumia", "matumizi", "hutumia", "mtumiaji", "watumiaji",
    "chombo", "zana", "ujuzi", "msaidizi", "wakala",
  ],
  markers: ["mtumiaji", "kutumia", "wakati", "ambayo", "kwa", "ikiwa", "hutumia"],
  triggerSignals: [
    /\b(tumia|kutumia|itumike|hutumika)\b[\s\S]{0,45}\b(wakati|ikiwa|kabla|baada|pale)\b/,
    /\bwakati\s+(mtumiaji|mtu|mteja|anapo|unapo|inapo)/,
    /\bikiwa\s+(mtumiaji|mtu|inahitajika|unahitaji)/,
    /\bpale\s+(ambapo|mtumiaji)/,
    /\bkila\s+(wakati|mara)\b/,
    /\b(kabla|baada)\s+ya\s+\S/,
    /\bkwa\s+(kazi|maombi|maswali|hali|matukio)\b/,
    /\b(imeundwa|inafaa|ni\s+muhimu)\s+(kwa|kwaajili|kwa\s+ajili)/,
    /\bmatukio\s+ya\s+matumizi\b/,
    /\binapaswa\s+kutumika\b/,
  ],
  firstPerson: [
    /^\s*(mimi|ninaweza|tutakusaidia)\b/,
    /\bninaweza\s+kukusaidia\b/,
    /\bunaweza\s+kutumia\s+(ujuzi\s+)?(huu|hii)\b/,
  ],
  samples: {
    triggers: [
      "Hutengeneza ripoti za PDF kutoka faili za Markdown kwa kutumia kiolezo cha kampuni. Tumia wakati mtumiaji anaomba ripoti inayoweza kuchapishwa au kuhamisha maelezo kwa uchapishaji.",
      "Hukagua mabadiliko yaliyoandaliwa ili kubaini hitilafu na hali za mipaka zilizosahaulika. Tumia kabla ya mtumiaji kufanya commit, au pale ambapo anaomba kuangalia diff tena.",
    ],
    capabilityOnly: [
      "Hutoa mkusanyiko kamili wa programu ndogo za kuchakata hati za PDF na kutoa majedwali yaliyomo ndani yake.",
    ],
  },
};

import type { LanguagePack } from "./types.js";

export const it: LanguagePack = {
  code: "it",
  name: "Italian",
  endonym: "Italiano",
  scripts: ["latin"],
  stopwords: [
    "a", "ad", "agli", "ai", "al", "alla", "alle", "allo", "altre", "altri",
    "altro", "anche", "che", "chi", "ci", "col", "come", "con", "cui", "da",
    "dai", "dal", "dalla", "degli", "dei", "del", "della", "delle", "dello", "di",
    "dopo", "dove", "due", "e", "ed", "essere", "fa", "fare", "fra", "gia", "gli",
    "ha", "hanno", "i", "il", "in", "io", "la", "le", "lei", "li", "lo", "loro",
    "lui", "ma", "mi", "mia", "mio", "ne", "nel", "nella", "nelle", "noi", "non",
    "o", "od", "ogni", "per", "piu", "posso", "prima", "puo", "possono", "qui",
    "quale", "quando", "quello", "questa", "queste", "questi", "questo", "sono",
    "se", "si", "solo", "su", "sua", "sue", "sui", "sul", "sulla", "suo", "ti",
    "tra", "tu", "tutti", "tutto", "un", "una", "uno", "usa", "usare", "uso",
    "utente", "utenti", "utilizza", "utilizzare", "vi", "voi",
  ],
  markers: ["quando", "utente", "quindi", "questa", "perche", "utilizzo"],
  triggerSignals: [
    /\bus[ao](?:re|lo|la|te|rlo|rla)?\b[^.]{0,25}\b(quando|se|prima|dopo|per)\b/,
    /\butilizz(?:a|are|alo|ate|arlo)\b[^.]{0,25}\b(quando|se|prima|dopo|per)\b/,
    /\bquando\s+(l['’]?utente|un\s+utente|il\s+cliente|qualcuno|si\s+|chiede|richiede|serve)/,
    /\bse\s+(l['’]?utente|un\s+utente|qualcuno)\b/,
    /\bogni\s+volta\s+che\b/,
    /\bnel\s+caso\s+(in\s+cui|di)\b/,
    /\b(prima|dopo)\s+(di|del|della|che)\b/,
    /\bper\s+(attivita|richieste|casi|situazioni|domande|flussi)\b/,
    /\b(pensato|progettato|indicato|adatto|utile|destinato)\s+(per|quando|a)\b/,
    /\bsi\s+(usa|utilizza|applica|attiva)\b/,
    /\bda\s+(usare|utilizzare)\b/,
    /\bcasi?\s+d['’]?\s*uso\b/,
  ],
  firstPerson: [
    /^\s*(io|posso)\b/,
    /\bposso\s+(aiutarti|assisterti|mostrarti|guidarti)\b/,
    /\bpuoi\s+usare\s+(questo|questa\s+abilita)\b/,
  ],
  samples: {
    triggers: [
      "Genera report PDF da file Markdown con il modello aziendale. Da usare quando l'utente chiede di creare un report stampabile o di esportare appunti per la stampa.",
      "Rilegge le modifiche in staging alla ricerca di bug e casi limite. Si usa prima che l'utente esegua un commit, oppure ogni volta che chiede una seconda lettura del diff.",
    ],
    capabilityOnly: [
      "Fornisce un insieme completo di strumenti per la manipolazione dei documenti PDF e l'estrazione delle loro tabelle.",
    ],
  },
};

import type { LanguagePack } from "./types.js";

export const fr: LanguagePack = {
  code: "fr",
  name: "French",
  endonym: "Français",
  scripts: ["latin"],
  stopwords: [
    "a", "afin", "ainsi", "alors", "apres", "au", "aussi", "autre", "autres",
    "aux", "avant", "avec", "avoir", "ce", "cela", "ces", "cet", "cette", "chaque",
    "chez", "comme", "dans", "de", "des", "deja", "depuis", "donc", "dont", "du",
    "elle", "elles", "en", "encore", "entre", "est", "et", "etait", "etre", "eux",
    "fait", "faire", "ici", "il", "ils", "je", "la", "le", "les", "leur", "leurs",
    "lui", "mais", "meme", "mes", "moins", "mon", "ne", "ni", "nos", "notre",
    "nous", "on", "ont", "ou", "par", "pas", "pendant", "peut", "peuvent", "plus",
    "pour", "pourquoi", "quand", "que", "quel", "quelle", "qui", "quoi", "sa",
    "sans", "se", "ses", "si", "sont", "sous", "sur", "tous", "tout", "toute",
    "toutes", "tres", "tu", "un", "une", "utilisateur", "utilisateurs",
    "utilisation", "utilise", "utiliser", "vers", "vos", "votre", "vous", "y",
  ],
  markers: ["lorsque", "utilisateur", "afin", "donc", "cette", "vous", "quand"],
  triggerSignals: [
    /\butilis(?:er|ez|e|ee)\b[^.]{0,25}\b(lorsque|quand|si|avant|apres|pour)\b/,
    /\b(lorsque|quand)\s+(l['’]?utilisateur|un\s+utilisateur|l['’]?usager|vous|on|le\s+client|quelqu)/,
    /\ba\s+utiliser\b/,
    /\bs['’]utilise\b/,
    /\bdes\s+que\b/,
    /\b(avant|apres)\s+(de|d['’]|la|le|les|chaque|avoir)\b/,
    /\bpour\s+(les\s+)?(taches|demandes|requetes|cas|situations|questions|flux)\b/,
    /\bcas\s+d['’]?\s*(usage|utilisation)\b/,
    /\b(conc(?:u|ue)|destine|destinee|prevu|prevue|utile|adapte|adaptee)\s+(pour|lorsque|quand|aux?)\b/,
    /\bappliqu(?:er|e|ez)\b[^.]{0,25}\b(lorsque|quand|si)\b/,
    /\bau\s+moment\s+(ou|de)\b/,
    /\blors\s+(de|du|des)\b/,
    /\bdeclench(?:e|er|ee|ement)\b/,
    /\bsi\s+(l['’]?utilisateur|un\s+utilisateur|quelqu)/,
  ],
  firstPerson: [
    /^\s*(je|j['’]|nous\s+(pouvons|allons))\b/,
    /\bje\s+(peux|vais|pourrai)\b/,
    /\bvous\s+pouvez\s+utiliser\s+(ceci|cette\s+competence)\b/,
  ],
  samples: {
    triggers: [
      "Génère des rapports PDF à partir de fichiers Markdown avec le modèle maison. À utiliser lorsque l'utilisateur demande de créer un rapport imprimable ou d'exporter des notes pour impression.",
      "Relit les modifications indexées à la recherche de bugs et de cas limites. S'utilise avant que l'utilisateur ne valide un commit, ou quand il demande une seconde lecture du diff.",
    ],
    capabilityOnly: [
      "Fournit un ensemble complet d'utilitaires de manipulation de documents PDF et d'extraction de leurs tableaux.",
    ],
  },
};

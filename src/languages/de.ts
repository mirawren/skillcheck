import type { LanguagePack } from "./types.js";

export const de: LanguagePack = {
  code: "de",
  name: "German",
  endonym: "Deutsch",
  scripts: ["latin"],
  stopwords: [
    "aber", "alle", "alles", "als", "am", "an", "andere", "auch", "auf", "aus",
    "bei", "beim", "bin", "bis", "da", "damit", "dann", "das", "dass", "dem",
    "den", "der", "des", "die", "dies", "diese", "diesem", "diesen", "dieser",
    "dieses", "doch", "dort", "du", "durch", "ein", "eine", "einem", "einen",
    "einer", "eines", "er", "es", "etwa", "fur", "gegen", "hat", "hatte", "haben",
    "hier", "ich", "ihr", "ihre", "im", "in", "ins", "ist", "jede", "jeder",
    "kann", "keine", "konnen", "man", "mehr", "mein", "mit", "muss", "mussen",
    "nach", "nicht", "noch", "nur", "ob", "oder", "ohne", "schon", "sehr", "sein",
    "seine", "sich", "sie", "sind", "so", "soll", "sollen", "uber", "um", "und",
    "uns", "unter", "vom", "von", "vor", "war", "waren", "was", "wenn", "wer",
    "werden", "wie", "wir", "wird", "wo", "zu", "zum", "zur", "zwischen",
    "anwender", "benutzer", "nutzer", "nutzen", "verwenden", "verwendet",
  ],
  markers: ["wenn", "werden", "nutzer", "sollte", "damit", "falls", "beim"],
  triggerSignals: [
    /\b(verwend\w*|nutz\w*|benutz\w*|einsetz\w*|anwend\w*|einzusetzen|anzuwenden)\b[\s\S]{0,45}\bwenn\b/,
    /\bwenn\s+(der|die|das|ein|eine|jemand|nutzer|benutzer|anwender|du|sie|man)\b/,
    /\bimmer\s+wenn\b/,
    /\b(falls|sobald|sofern)\b/,
    /\b(bevor|nachdem|wahrend)\b/,
    /\bbeim\s+\w{3,}en\b/,
    /\bzum\s+einsatz\b/,
    /\b(anwendungsfall|anwendungsfalle|einsatzzweck|einsatzgebiet)\b/,
    /\bfur\s+(aufgaben|anfragen|fragen|falle|situationen|workflows|arbeitsablaufe)\b/,
    /\b(gedacht|vorgesehen|geeignet|bestimmt)\s+(fur|wenn|zum)\b/,
    /\bsollte\s+(dann\s+)?(verwendet|genutzt|benutzt|eingesetzt)\b/,
  ],
  firstPerson: [
    /^\s*(ich|wir\s+(konnen|werden))\b/,
    /\bich\s+(kann|werde|helfe)\b/,
    /\bdu\s+kannst\s+(dies|diese\s+fahigkeit)\b/,
  ],
  samples: {
    triggers: [
      "Erzeugt PDF-Berichte aus Markdown-Dateien mit der hauseigenen Vorlage. Verwenden, wenn der Nutzer einen druckbaren Bericht erstellen oder Notizen zum Drucken exportieren möchte.",
      "Prüft vorgemerkte Änderungen auf Fehler und übersehene Grenzfälle. Sollte vor jedem Commit eingesetzt werden, oder falls jemand um einen zweiten Blick auf das Diff bittet.",
    ],
    capabilityOnly: [
      "Bietet eine umfassende Sammlung von Werkzeugen zur Bearbeitung von PDF-Dokumenten und zur Extraktion ihrer Tabellen.",
    ],
  },
};

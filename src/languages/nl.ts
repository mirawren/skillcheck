import type { LanguagePack } from "./types.js";

export const nl: LanguagePack = {
  code: "nl",
  name: "Dutch",
  endonym: "Nederlands",
  scripts: ["latin"],
  stopwords: [
    "aan", "al", "alle", "als", "andere", "bij", "daar", "dan", "dat", "de",
    "deze", "die", "dit", "door", "dus", "een", "elke", "en", "er", "geen", "had",
    "heeft", "hebben", "het", "hier", "hij", "hun", "ik", "in", "is", "je", "kan",
    "kunnen", "maar", "meer", "men", "met", "mijn", "moet", "moeten", "na", "naar",
    "niet", "nog", "of", "om", "onder", "ons", "onze", "ook", "op", "over", "te",
    "tussen", "u", "uit", "van", "veel", "voor", "want", "waren", "was", "wat",
    "we", "werd", "worden", "wordt", "wij", "zeer", "zijn", "zich", "zij", "zo",
    "zonder", "gebruik", "gebruiken", "gebruikt", "gebruiker", "gebruikers",
  ],
  markers: ["wanneer", "gebruiker", "wordt", "zodra", "waarbij", "vaardigheid"],
  triggerSignals: [
    /\b(gebruik|gebruiken|inzetten|toepassen|aanroepen)\b[\s\S]{0,45}\b(wanneer|als|voordat|nadat|bij)\b/,
    /\b(wanneer|als)\s+(de|een|het)?\s*(gebruiker|klant|iemand|je|u)\b/,
    /\btelkens\s+(als|wanneer)\b/,
    /\bzodra\b/,
    /\b(voordat|nadat|tijdens)\b/,
    /\bbij\s+het\s+\w{3,}en\b/,
    /\bvoor\s+(taken|verzoeken|vragen|situaties|gevallen)\b/,
    /\b(bedoeld|geschikt|handig|bestemd)\s+(voor|wanneer|als)\b/,
    /\bgebruiksscenario/,
  ],
  firstPerson: [
    /^\s*(ik|wij\s+kunnen)\b/,
    /\bik\s+(kan|zal|help)\b/,
    /\bje\s+kunt\s+(dit|deze\s+vaardigheid)\s+gebruiken\b/,
  ],
  samples: {
    triggers: [
      "Genereert PDF-rapporten uit Markdown-bestanden met de huisstijl. Gebruik dit wanneer de gebruiker vraagt om een afdrukbaar rapport of om notities te exporteren voor afdrukken.",
      "Leest klaargezette wijzigingen na op bugs en gemiste randgevallen. Zet dit in voordat de gebruiker een commit maakt, of als iemand om een tweede blik op de diff vraagt.",
    ],
    capabilityOnly: [
      "Biedt een uitgebreide verzameling hulpmiddelen voor het bewerken van PDF-documenten en het extraheren van hun tabellen.",
    ],
  },
};

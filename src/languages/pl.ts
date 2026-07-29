import type { LanguagePack } from "./types.js";

export const pl: LanguagePack = {
  code: "pl",
  name: "Polish",
  endonym: "Polski",
  scripts: ["latin"],
  stopwords: [
    "ale", "albo", "bardzo", "bez", "byc", "byl", "byla", "bylo", "co", "czy",
    "dla", "do", "gdy", "gdzie", "go", "i", "ich", "im", "inny", "jak", "jako",
    "je", "jego", "jej", "jest", "jesli", "jezeli", "juz", "kazdy", "kiedy",
    "kto", "ktora", "ktore", "ktory", "lub", "ma", "maja", "mnie", "moze",
    "moga", "musi", "my", "na", "nad", "nie", "niz", "o", "od", "oraz", "on",
    "ona", "oni", "po", "pod", "podczas", "powinien", "przed", "przez", "przy",
    "sa", "sie", "tak", "takze", "tam", "te", "tego", "tej", "ten", "to", "tu",
    "tylko", "tym", "u", "w", "we", "wiecej", "wszystko", "za", "ze", "zeby",
    "uzyj", "uzywaj", "uzycie", "uzytkownik", "uzytkownicy", "umiejetnosc",
  ],
  markers: ["gdy", "kiedy", "jesli", "uzytkownik", "nalezy", "przez", "umiejetnosc"],
  triggerSignals: [
    /\b(uzyj|uzywaj|uzywac|stosuj|stosowac|wywolaj|zastosuj)\b[\s\S]{0,45}\b(gdy|kiedy|jesli|jezeli|przed|po|do)\b/,
    /\b(gdy|kiedy)\s+(uzytkownik|klient|ktos|prosi|poprosi|chce|potrzebuje|zapyta)\b/,
    /\b(jesli|jezeli)\s+(uzytkownik|ktos|klient)\b/,
    /\bza\s+kazdym\s+razem\b/,
    /\bw\s+przypadku\b/,
    /\bw\s+sytuacji\b/,
    /\bdo\s+(zadan|zapytan|pytan|przypadkow)\b/,
    /\b(przeznaczon[ay]|przydatn[ay]|sluzy)\s+(do|gdy|kiedy)\b/,
    /\bnalezy\s+(uzyc|stosowac|wywolac)\b/,
    /\bprzypadki\s+uzycia\b/,
  ],
  firstPerson: [
    /^\s*(ja|moge)\b/,
    /\bmoge\s+(ci\s+)?(pomoc|pokazac)\b/,
    /\bmozesz\s+uzyc\s+(tego|tej\s+umiejetnosci)\b/,
  ],
  samples: {
    triggers: [
      "Generuje raporty PDF z plików Markdown na firmowym szablonie. Użyj, gdy użytkownik prosi o raport do wydruku lub o wyeksportowanie notatek do druku.",
      "Sprawdza przygotowane zmiany pod kątem błędów i pominiętych przypadków brzegowych. Należy stosować przed każdym commitem, jeśli użytkownik prosi o drugie spojrzenie na diff.",
    ],
    capabilityOnly: [
      "Zapewnia kompletny zestaw narzędzi do manipulowania dokumentami PDF oraz wyodrębniania zawartych w nich tabel.",
    ],
  },
};

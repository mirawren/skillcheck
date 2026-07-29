import type { LanguagePack } from "./types.js";

/**
 * Hebrew is written here without niqqud, which is how technical prose is
 * actually written and also what `fold` produces — the vowel points are
 * combining marks and Hebrew is in STRIP_MARKS (src/script.ts).
 *
 * The one-letter prefixes (ה־, ב־, ל־, ו־, מ־, ש־, כ־) attach directly to the
 * word they govern, and separating them takes real morphology. Nothing here
 * pretends otherwise: the stopword list holds whole words, and the trigger
 * patterns match the prefix as part of the following word rather than trying to
 * strip it. That is why `לפני\s+ש` appears as one pattern instead of two.
 */
export const he: LanguagePack = {
  code: "he",
  name: "Hebrew",
  endonym: "עברית",
  scripts: ["hebrew"],
  stopwords: [
    "של", "את", "על", "עם", "אל", "מן", "אם", "כי", "גם", "רק", "כל", "זה",
    "זו", "אלה", "אלו", "הוא", "היא", "הם", "הן", "אני", "אתה", "אנחנו",
    "יש", "אין", "לא", "כן", "או", "אבל", "אך", "כאשר", "מתי", "איך", "למה",
    "איפה", "כדי", "לפני", "אחרי", "בעת", "בזמן", "צריך", "יכול", "ניתן",
    "אשר", "כמו", "בין", "עבור", "לכל", "מאוד", "יותר", "פחות", "אותו",
    "אותה", "היה", "היו", "להיות", "שהוא", "שהיא",
    // Domain noise: true of nearly every skill written in Hebrew.
    "משתמש", "המשתמש", "שימוש", "להשתמש", "השתמש", "כלי", "כלים", "מיומנות",
    "יכולת", "סוכן", "עוזר",
  ],
  markers: ["כאשר", "המשתמש", "השתמש", "עבור", "כדי", "אשר"],
  triggerSignals: [
    /השתמש\p{L}*[\s\S]{0,40}(כאשר|כש|אם|לפני|אחרי|בכל\s+פעם)/u,
    /כאשר\s+(המשתמש|מישהו|מבקש|צריך|רוצה|נדרש)/u,
    /כש(המשתמש|מישהו|מבקשים|צריך)/u,
    /אם\s+(המשתמש|מישהו|נדרש|צריך)/u,
    /בכל\s+פעם\s+ש/u,
    /(לפני|אחרי)\s+ש\p{L}/u,
    /במקרה\s+ש/u,
    /עבור\s+(משימות|בקשות|שאלות|מקרים|תרחישי)/u,
    /(מיועד|מתאים|שימושי)\s+ל\p{L}/u,
    /(מקרי|תרחישי)\s+שימוש/u,
    /יש\s+להשתמש/u,
  ],
  firstPerson: [
    /^\s*(אני|נוכל|אוכל)(?![\p{L}])/u,
    /אני\s+(יכול|אעזור|אוכל)/u,
    /אתה\s+יכול\s+להשתמש\s+ב(כלי\s+)?זה/u,
  ],
  samples: {
    triggers: [
      "יוצר דוחות PDF מקבצי Markdown לפי תבנית החברה. השתמש כאשר המשתמש מבקש להפיק מסמך להדפסה או לייצא הערות להדפסה.",
      "בודק את השינויים המוכנים לאיתור באגים ומקרי קצה שנשכחו. השתמש לפני שהמשתמש מבצע commit, או כאשר מבקשים מבט נוסף על ה־diff.",
    ],
    capabilityOnly: [
      "מספק אוסף מקיף של תוכניות עזר לעיבוד מסמכי PDF ולחילוץ הטבלאות שבתוכם.",
    ],
  },
};

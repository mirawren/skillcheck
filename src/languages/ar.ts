import type { LanguagePack } from "./types.js";

/**
 * Arabic is normalized the way Arabic information retrieval always normalizes:
 * harakat and tatweel are removed, the alef and yeh variants are collapsed, and
 * taa marbuta folds to haa (see `fold` in src/script.ts). Stopwords and
 * patterns here are therefore written in that normalized form — `عندما`, not a
 * vocalized spelling — because that is what the tokenizer will hand them.
 */
export const ar: LanguagePack = {
  code: "ar",
  name: "Arabic",
  endonym: "العربية",
  scripts: ["arabic"],
  stopwords: [
    "في", "من", "الي", "علي", "عن", "مع", "بين", "هذا", "هذه", "ذلك", "تلك",
    "التي", "الذي", "الذين", "ما", "لا", "لم", "لن", "قد", "و", "او", "ثم",
    "كل", "بعض", "هو", "هي", "هم", "انا", "نحن", "انت", "كان", "كانت", "يكون",
    "تكون", "هناك", "ايضا", "جدا", "اكثر", "عند", "عندما", "اذا", "حيث", "كيف",
    "لماذا", "الا", "بعد", "قبل", "حتي", "لكن", "به", "له", "لها", "ان",
    "استخدام", "استخدم", "يستخدم", "المستخدم", "مستخدم", "المهاره", "مهاره",
    "اداه", "الاداه", "يمكن", "يجب",
  ],
  markers: ["عندما", "المستخدم", "استخدام", "الي", "التي", "يجب"],
  triggerSignals: [
    /استخدم\S*[\s\S]{0,35}(عندما|اذا|قبل|بعد|عند)/,
    /عندما\s+(يطلب|يريد|يسال|يحتاج|يقوم|المستخدم|يكون)/,
    /عند\s+(طلب|انشاء|كتابه|مراجعه|تحويل|الحاجه|العمل)/,
    /اذا\s+(طلب|اراد|احتاج|كان)/,
    /في\s+حال[هة]?(?![\p{L}])/u,
    /(قبل|بعد|اثناء)\s+\S/,
    /يستخدم\s+(عندما|في|ل)/,
    /(مصمم|مخصص|مناسب|مفيد)\s+ل/,
    /حالات\s+الاستخدام/,
    // `\b` is defined on [A-Za-z0-9_] and so never fires between two Arabic
    // letters — a word boundary here has to be spelled as "no letter follows".
    /(لمهام|للطلبات|للاسئله|للحالات)(?![\p{L}\p{M}])/u,
  ],
  firstPerson: [
    /^\s*(انا|يمكنني)/,
    /يمكنني\s+(مساعدتك|مساعده|ان)/,
    /يمكنك\s+استخدام\s+(هذا|هذه)/,
  ],
  samples: {
    triggers: [
      "ينشئ تقارير PDF من ملفات Markdown بقالب الشركة. استخدمه عندما يطلب المستخدم تقريرا قابلا للطباعة أو تصدير الملاحظات للطباعة.",
      "يراجع التغييرات المجهزة بحثا عن الأخطاء والحالات الحدية المنسية. يستخدم قبل أن ينشئ المستخدم أي commit، أو عند طلب مراجعة ثانية للفروق.",
    ],
    capabilityOnly: [
      "يوفر مجموعة شاملة من الأدوات لمعالجة مستندات PDF واستخراج الجداول الموجودة بداخلها.",
    ],
  },
};

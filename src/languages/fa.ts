import type { LanguagePack } from "./types.js";

/**
 * Persian shares the Arabic script but almost none of its function words, which
 * is what lets {@link import("./index.js").detect} tell the two apart: `را`,
 * `که`, `این` and `برای` are everywhere in Persian and nowhere in Arabic.
 *
 * It also keeps its own letters. Persian yeh (`ی`, U+06CC) and keheh (`ک`,
 * U+06A9) are distinct code points from the Arabic `ي` and `ك`, and `fold`
 * leaves them alone — so everything here is written with the Persian forms,
 * which is what Persian text actually contains. The alef variants and the
 * harakat do fold, exactly as they do for Arabic, so `آن` is written `ان`.
 *
 * ZWNJ (U+200C) — the zero-width non-joiner that separates `می` from its verb
 * and `ها` from its noun — is not a word character, so the tokenizer treats it
 * as a break. That is the right answer: `فایل‌های` yields `فایل`, the term a
 * request would actually contain.
 */
export const fa: LanguagePack = {
  code: "fa",
  name: "Persian",
  endonym: "فارسی",
  scripts: ["arabic"],
  stopwords: [
    "و", "در", "به", "از", "را", "که", "این", "ان", "با", "برای", "تا", "یا",
    "هم", "هر", "همه", "است", "هست", "بود", "شد", "شود", "شده", "می", "نمی",
    "کند", "کنید", "کردن", "کرده", "خود", "اگر", "وقتی", "هنگامی", "زمانی",
    "چون", "اما", "ولی", "نیز", "بسیار", "باید", "بین", "روی", "پس", "قبل",
    "بعد", "دارد", "دارند", "داشته", "های", "ها", "یک", "چه", "کجا", "چرا",
    "چگونه", "من", "شما", "ما", "او", "انها", "توسط", "طور", "مورد",
    // Domain noise: true of nearly every skill written in Persian.
    "استفاده", "کاربر", "کاربران", "ابزار", "ابزارها", "مهارت", "دستیار",
  ],
  markers: ["را", "که", "این", "برای", "می", "است", "هنگامی", "کاربر", "وقتی"],
  triggerSignals: [
    /استفاده\s+(کنید|شود|می\s*شود)[\s\S]{0,40}(وقتی|هنگامی|زمانی|اگر|قبل|بعد)/u,
    /(وقتی|هنگامی|زمانی)\s+که\s+(کاربر|کسی|شخص|نیاز|درخواست)/u,
    /اگر\s+(کاربر|کسی|نیاز|لازم)/u,
    /هر\s+بار\s+که/u,
    /در\s+صورت(ی|\s)/u,
    /(قبل|پس|بعد)\s+از\s+\S/u,
    /برای\s+(کارها|وظایف|درخواست|پرسش|سوال|موارد|سناریو)/u,
    /(طراحی\s+شده|مناسب|مفید)\s+برای/u,
    /موارد\s+استفاده/u,
    /باید\s+استفاده\s+شود/u,
  ],
  firstPerson: [
    /^\s*(من|ما\s+می\s*توانیم)(?![\p{L}])/u,
    /من\s+می\s*توانم\s+(به\s+شما\s+)?(کمک|راهنمایی)/u,
    /شما\s+می\s*توانید\s+از\s+این\s+(مهارت|ابزار)\s+استفاده/u,
  ],
  samples: {
    triggers: [
      "گزارش‌های PDF را از فایل‌های Markdown با قالب شرکت می‌سازد. هنگامی که کاربر درخواست گزارش قابل چاپ یا خروجی یادداشت‌ها برای چاپ می‌کند، از آن استفاده کنید.",
      "تغییرات آماده‌شده را برای یافتن خطاها و حالت‌های مرزی جامانده بررسی می‌کند. قبل از اینکه کاربر commit بزند استفاده کنید، یا وقتی که کاربر بازبینی دوباره‌ی diff را می‌خواهد.",
    ],
    capabilityOnly: [
      "مجموعه‌ای کامل از برنامه‌های کمکی جهت پردازش اسناد PDF و بیرون کشیدن جدول‌های درون آن‌ها فراهم می‌کند.",
    ],
  },
};

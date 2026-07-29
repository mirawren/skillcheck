import type { LanguagePack } from "./types.js";

/**
 * Bengali keeps its combining marks: like Devanagari it is an abugida, where
 * the vowel signs *are* the vowels, so `fold` leaves them in place (see
 * STRIP_MARKS in src/script.ts).
 *
 * It has the same prefix trap Hindi does, and worse: `ব্যবহার` ("use") opens
 * `ব্যবহারকারী` ("user"), the single most common noun in any description. `\b`
 * cannot separate them — it is defined on [A-Za-z0-9_] and never fires between
 * two Bengali characters — so every pattern built on that stem ends in an
 * explicit `(?![\p{L}\p{M}])`.
 */
export const bn: LanguagePack = {
  code: "bn",
  name: "Bengali",
  endonym: "বাংলা",
  scripts: ["brahmic"],
  stopwords: [
    "এবং", "বা", "কিন্তু", "এর", "এই", "সেই", "তার", "যে", "যা", "যখন",
    "তখন", "যদি", "তবে", "না", "নেই", "হয়", "হবে", "ছিল", "করে", "করা",
    "করুন", "করতে", "থেকে", "জন্য", "সাথে", "দিয়ে", "উপর", "মধ্যে", "আছে",
    "একটি", "একটা", "সব", "সকল", "প্রতি", "কি", "কেন", "কোথায়", "আমি",
    "আপনি", "আমরা", "তারা", "এটি", "এটা", "ও", "আরও", "খুব", "পারে",
    "উচিত", "মতো", "সহ", "পরে", "আগে", "সময়",
    // Domain noise: true of nearly every skill written in Bengali.
    "ব্যবহার", "ব্যবহারকারী", "দক্ষতা", "সরঞ্জাম", "টুল", "সহকারী", "এজেন্ট",
  ],
  markers: ["ব্যবহারকারী", "যখন", "জন্য", "করুন", "যদি", "এবং"],
  triggerSignals: [
    /(?:ব্যবহার|প্রয়োগ)(?![\p{L}\p{M}])[\s\S]{0,30}(?:যখন|যদি|আগে|পরে)/u,
    /যখন\s+(ব্যবহারকারী|কেউ|গ্রাহক|আপনি)/u,
    /যদি\s+(ব্যবহারকারী|কেউ|প্রয়োজন)/u,
    // Bengali puts the subject first, so the everyday "when the user asks…"
    // is written "ব্যবহারকারী যখন … তখন" — subject, then the conjunction. A
    // pattern that only looks for `যখন` *before* the subject misses the
    // ordinary phrasing entirely.
    /(ব্যবহারকারী|কেউ|গ্রাহক|আপনি)\s+যখন/u,
    // The clause between "when" and "then use it" carries the whole condition,
    // so the window has to be wide enough to hold a real one.
    /(?:যখন|যদি)[\s\S]{0,60}(?:ব্যবহার|প্রয়োগ)\s*কর(?:ুন|তে|ব)/u,
    /প্রতিবার\s+যখন/u,
    /(?:আগে|পরে|সময়)\s+ব্যবহার(?![\p{L}\p{M}])/u,
    /(?:কাজের|অনুরোধের|প্রশ্নের|পরিস্থিতির)\s+জন্য/u,
    /(?:উপযুক্ত|উপযোগী|ডিজাইন\s+করা)\s+(?:হয়েছে\s+)?(?:যখন|জন্য)/u,
    /ব্যবহারের\s+ক্ষেত্র/u,
  ],
  firstPerson: [
    /^\s*(আমি|আমরা)(?![\p{L}\p{M}])/u,
    /আমি\s+(আপনাকে|আপনার)\s*(সাহায্য|সহায়তা)/u,
    /আপনি\s+এই\s+(দক্ষতা|টুল)(?:টি)?\s+ব্যবহার\s+করতে\s+পারেন/u,
  ],
  samples: {
    triggers: [
      "Markdown ফাইল থেকে কোম্পানির টেমপ্লেটে ছাপার যোগ্য PDF রিপোর্ট তৈরি করে। ব্যবহারকারী যখন ছাপার যোগ্য রিপোর্ট বা নোট রপ্তানি চান তখন এটি ব্যবহার করুন।",
      "প্রস্তুত করা পরিবর্তনগুলিতে বাগ এবং বাদ পড়া প্রান্তিক ক্ষেত্র পরীক্ষা করে। commit করার আগে ব্যবহার করুন, অথবা যখন ব্যবহারকারী diff আবার দেখতে বলেন।",
    ],
    capabilityOnly: [
      "PDF নথি প্রক্রিয়াকরণ এবং সেগুলির মধ্যে থাকা টেবিল নিষ্কাশনের একটি বিস্তৃত সংগ্রহ সরবরাহ করে।",
    ],
  },
};

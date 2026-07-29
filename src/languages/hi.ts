import type { LanguagePack } from "./types.js";

/**
 * Devanagari keeps its combining marks: in an abugida the marks *are* the
 * vowels, so the accent-folding that helps Latin would turn `कि` into `क`. See
 * the script gate in `fold` (src/script.ts).
 */
export const hi: LanguagePack = {
  code: "hi",
  name: "Hindi",
  endonym: "हिन्दी",
  scripts: ["devanagari"],
  stopwords: [
    "और", "या", "लेकिन", "के", "का", "की", "को", "में", "से", "पर", "तक",
    "लिए", "है", "हैं", "था", "थे", "थी", "हो", "होता", "होती", "होते", "कर",
    "करना", "करें", "यह", "वह", "ये", "वे", "जो", "जब", "तब", "अगर", "यदि",
    "नहीं", "भी", "केवल", "बहुत", "अधिक", "सभी", "हर", "अन्य", "कैसे", "क्या",
    "कौन", "कहाँ", "क्यों", "एक", "कुछ", "इस", "उस", "मैं", "आप", "हम",
    "उपयोग", "उपयोगकर्ता", "प्रयोग", "इस्तेमाल", "कौशल", "उपकरण", "सकता",
    "सकते", "चाहिए", "साथ", "बाद", "पहले", "द्वारा",
  ],
  markers: ["उपयोगकर्ता", "जब", "करें", "लिए", "चाहिए", "कौशल"],
  triggerSignals: [
    // `उपयोग` ("use") opens two much more common words — `उपयोगकर्ता` ("user")
    // and `उपयोगिताओं` ("utilities") — so every pattern built on it needs an
    // explicit end-of-word. `\b` cannot supply one: it is defined on
    // [A-Za-z0-9_] and never fires between two Devanagari characters. Spelling
    // it as "no letter or vowel sign follows" is what keeps
    // "…के लिए उपयोगिताओं का संग्रह" (a capability) from reading as
    // "…के लिए उपयोग" (a trigger).
    /(?:उपयोग|प्रयोग|इस्तेमाल)(?![\p{L}\p{M}])\s+कर[ेंाओ]*[\s\S]{0,25}(?:जब|यदि|अगर|पहले|बाद)/u,
    /जब\s+(उपयोगकर्ता|कोई|यूज़र|यूजर|ग्राहक|आप)/,
    /(यदि|अगर)\s+(उपयोगकर्ता|कोई|आप)/,
    /(?:के\s+लिए|हेतु)\s*(?:उपयोग|प्रयोग|इस्तेमाल)(?![\p{L}\p{M}])/u,
    /(से\s+पहले|के\s+बाद|के\s+दौरान)/,
    /जब\s+भी(?![\p{L}\p{M}])/u,
    /तब\s+(?:उपयोग|प्रयोग|इस्तेमाल)(?![\p{L}\p{M}])/u,
    /(कार्यों|अनुरोधों|प्रश्नों|स्थितियों)\s+के\s+लिए/,
    // "…के लिए उपयुक्त/डिज़ाइन किया गया" — suitable for / designed for. The
    // postposition is required: `उपयोगी` ("useful") on its own says nothing
    // about *when* the skill applies, and accepting it bare switched this rule
    // off for the language.
    /(?:के\s+लिए|हेतु)\s*(?:उपयुक्त|उपयोगी|डिज़ाइन|डिजाइन)(?![\p{L}\p{M}])/u,
    /(डिज़ाइन|डिजाइन)\s+किया\s+गया/,
  ],
  firstPerson: [
    /^\s*(मैं|मै)(?![\p{L}\p{M}])/u,
    /मैं\s+(आपकी|आपको|तुम्हारी)\s*(मदद|सहायता)/,
    /आप\s+(इसका|इस\s+कौशल\s+का)\s+उपयोग\s+कर\s+सकते/,
  ],
  samples: {
    triggers: [
      "Markdown फाइलों से कंपनी टेम्पलेट में PDF रिपोर्ट बनाता है। इसका उपयोग करें जब उपयोगकर्ता छपाई योग्य रिपोर्ट या नोट्स का निर्यात माँगे।",
      "तैयार बदलावों में बग और छूटे हुए किनारे के मामलों की जाँच करता है। commit से पहले उपयोग करें, या जब उपयोगकर्ता diff पर दूसरी नज़र माँगे।",
    ],
    capabilityOnly: [
      "PDF दस्तावेज़ों के प्रसंस्करण और उनमें मौजूद तालिकाओं को निकालने के लिए उपयोगिताओं का एक संपूर्ण संग्रह प्रदान करता है।",
    ],
  },
};

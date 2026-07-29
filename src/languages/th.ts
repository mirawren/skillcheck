import type { LanguagePack } from "./types.js";

/**
 * Thai is written without spaces between words, so the tokenizer segments it
 * into overlapping character bigrams like Han and Kana (see `isContinuous` in
 * src/script.ts). Two consequences shape this pack.
 *
 * First, the stopword list is deliberately short. Its entries have to be
 * *bigrams* to match anything, and a bigram is a fragment: `ที` is the front
 * half of `ที่` ("that") but also of any number of content words. A long list
 * would quietly delete real terms, which is the one mistake a pack must not
 * make — so only the fragments that are overwhelmingly grammatical are listed,
 * and the rest of the work is left to the trigger patterns.
 *
 * Second, those patterns are matched against the *folded* description, and
 * NFKC decomposes SARA AM: `สำ` becomes `สํา` and `คำ` becomes `คํา`. Every
 * pattern below is written in that decomposed form, because the composed one
 * would never match.
 */
export const th: LanguagePack = {
  code: "th",
  name: "Thai",
  endonym: "ไทย",
  scripts: ["thai"],
  stopwords: [
    // Bigrams of the highest-frequency grammatical words only.
    "และ", "หรือ", "ของ", "ใน", "เป็", "การ", "ให้", "ได้", "จา", "กับ",
    "แต่", "ไม่", "จะ", "ก็", "ถ้า", "โด", "เพื", "นี้", "นั้", "ที",
  ],
  markers: ["ผู้ใช้", "เมื่อ", "ใช้", "สําหรับ", "ควร"],
  triggerSignals: [
    /ใช้เมื่อ/u,
    /เมื่อผู้ใช้/u,
    /(หาก|ถ้า)ผู้ใช้/u,
    /เมื่อ(ต้องการ|มีการ|ผู้|คุณ|ระบบ)/u,
    /ทุกครั้งที่/u,
    /ในกรณีที่/u,
    /(ก่อน|หลัง|ระหว่าง)(ที่|การ)/u,
    /สําหรับ(งาน|คําขอ|คําถาม|กรณี|สถานการณ์)/u,
    /(เหมาะ|ออกแบบมา)(สําหรับ|เพื่อ)/u,
    /กรณีการใช้งาน/u,
    /ควรใช้เมื่อ/u,
  ],
  samples: {
    triggers: [
      "สร้างรายงาน PDF จากไฟล์ Markdown ตามเทมเพลตของบริษัท ใช้เมื่อผู้ใช้ขอรายงานที่พิมพ์ได้ หรือต้องการส่งออกบันทึกเพื่อพิมพ์",
      "ตรวจสอบการเปลี่ยนแปลงที่เตรียมไว้เพื่อหาข้อผิดพลาดและกรณีขอบที่มองข้าม ใช้เมื่อผู้ใช้ขอให้ตรวจ diff อีกครั้งก่อนทำการ commit",
    ],
    capabilityOnly: [
      "มีชุดโปรแกรมช่วยที่ครอบคลุมในการประมวลผลเอกสาร PDF และการแยกตารางที่อยู่ภายในเอกสารเหล่านั้น",
    ],
  },
};

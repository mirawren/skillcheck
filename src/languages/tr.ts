import type { LanguagePack } from "./types.js";

export const tr: LanguagePack = {
  code: "tr",
  name: "Turkish",
  endonym: "Türkçe",
  scripts: ["latin"],
  stopwords: [
    "ama", "ancak", "ayrica", "az", "bazi", "belki", "ben", "bir", "birkac",
    "biz", "bu", "bunu", "bunun", "burada", "cok", "cunku", "da", "daha", "de",
    "degil", "diger", "eger", "en", "fakat", "gibi", "hangi", "her", "hic", "ic",
    "icin", "ile", "ise", "kadar", "ki", "kim", "mi", "mu", "nasil", "ne",
    "neden", "nerede", "o", "olan", "olarak", "oldu", "olur", "onlar", "onun",
    "sen", "siz", "sonra", "su", "tum", "uzere", "var", "ve", "veya", "ya",
    "yok", "kullan", "kullanin", "kullanim", "kullanici", "kullanicilar",
    "beceri", "arac", "yapay", "zeka",
  ],
  markers: ["kullanin", "kullanici", "durumunda", "gerektiginde", "icin", "yapilir"],
  triggerSignals: [
    // "-dığında / -diğinde" — Turkish's dedicated "when X happens" suffix, and
    // by far the most common way a description states its trigger.
    /\w{3,}[dt][iu][gk][iu]nd[ae]\b/,
    /\bkullan(?:in|ilir|ilmali|iniz|ma)?\b[\s\S]{0,35}\b(zaman|durum|ise|istek|talep)/,
    /\b(kullanici|musteri|birisi)\b[\s\S]{0,30}\b(istedig|sordug|talep|isteyince)/,
    /\b(ne\s+zaman|her\s+zaman|durumlarda|durumunda|halinde|hallerinde)\b/,
    /\b(once|sonra|sirasinda|esnasinda)\b/,
    /\bicin\s+(gorevler|istekler|sorular|durumlar|kullanilir)\b/,
    /\b(tasarlanmistir|uygundur|kullanislidir)\b/,
    /\bkullanim\s+(senaryo|durum|alan)/,
    /\beger\b/,
  ],
  firstPerson: [
    /^\s*(ben|ben\s+size)\b/,
    /\b(size|sana)\s+yardimci\s+ol/,
    /\bbunu\s+kullanabilirsiniz\b/,
  ],
  samples: {
    triggers: [
      "Markdown dosyalarından kurumsal şablonla PDF raporlar üretir. Kullanıcı yazdırılabilir bir rapor istediğinde veya notları baskı için dışa aktarmak istediğinde kullanın.",
      "Hazırlanmış değişiklikleri hatalara ve gözden kaçan uç durumlara karşı inceler. Kullanıcı commit atmadan önce, ya da diff için ikinci bir bakış istediğinde çalıştırılır.",
    ],
    capabilityOnly: [
      "PDF belgelerini düzenlemek ve içindeki tabloları çıkarmak için kapsamlı bir araç kümesi sunar.",
    ],
  },
};

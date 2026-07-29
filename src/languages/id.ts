import type { LanguagePack } from "./types.js";

export const id: LanguagePack = {
  code: "id",
  name: "Indonesian",
  endonym: "Bahasa Indonesia",
  scripts: ["latin"],
  stopwords: [
    "acara", "ada", "adalah", "agar", "akan", "aku", "anda", "atau", "bagaimana",
    "bahwa", "banyak", "belum", "bisa", "boleh", "dalam", "dan", "dapat", "dari",
    "dengan", "di", "dia", "hanya", "harus", "ia", "ini", "itu", "jika", "juga",
    "kalau", "kami", "kamu", "karena", "ke", "kita", "lain", "lebih", "maka",
    "mereka", "mungkin", "nya", "oleh", "pada", "paling", "perlu", "saat", "saya",
    "sebagai", "seperti", "setiap", "semua", "sudah", "supaya", "tanpa", "tapi",
    "telah", "tetapi", "tidak", "untuk", "yang", "gunakan", "menggunakan",
    "penggunaan", "pengguna", "keterampilan", "alat", "ketika",
  ],
  markers: ["yang", "ketika", "pengguna", "digunakan", "untuk", "adalah", "dengan"],
  triggerSignals: [
    /\b(gunakan|digunakan|pakai|dipakai|panggil|terapkan)\b[\s\S]{0,45}\b(ketika|saat|jika|kalau|sebelum|setelah|untuk)\b/,
    /\b(ketika|saat|jika|kalau|bila)\s+(pengguna|klien|seseorang|user|meminta|ingin|perlu)\b/,
    /\bsetiap\s+kali\b/,
    /\b(sebelum|setelah|selama)\s+\w/,
    /\buntuk\s+(tugas|permintaan|pertanyaan|kasus|situasi|alur)\b/,
    /\b(dirancang|ditujukan|cocok|berguna)\s+(untuk|ketika|saat)\b/,
    /\bkasus\s+penggunaan\b/,
  ],
  firstPerson: [
    /^\s*(saya|aku)\b/,
    /\bsaya\s+(dapat|bisa|akan)\s+(membantu|menunjukkan)\b/,
    /\banda\s+(dapat|bisa)\s+menggunakan\s+ini\b/,
  ],
  samples: {
    triggers: [
      "Menghasilkan laporan PDF dari berkas Markdown dengan templat perusahaan. Gunakan ketika pengguna meminta laporan yang dapat dicetak atau ingin mengekspor catatan untuk dicetak.",
      "Memeriksa perubahan yang disiapkan untuk mencari bug dan kasus tepi yang terlewat. Dipakai sebelum pengguna membuat commit, atau jika seseorang meminta tinjauan kedua atas diff.",
    ],
    capabilityOnly: [
      "Menyediakan kumpulan lengkap utilitas pengolahan dokumen PDF beserta ekstraksi tabel di dalamnya.",
    ],
  },
};

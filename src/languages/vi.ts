import type { LanguagePack } from "./types.js";

/**
 * Vietnamese folds heavily: the tokenizer strips tone marks, so `mở` and `mo`
 * index the same. That is lossy, and it is applied identically to the request
 * and the description, so it costs precision rather than recall — the tradeoff
 * skillcheck takes everywhere rather than shipping a dictionary.
 */
export const vi: LanguagePack = {
  code: "vi",
  name: "Vietnamese",
  endonym: "Tiếng Việt",
  scripts: ["latin"],
  stopwords: [
    "va", "hoac", "nhung", "voi", "khong", "cho", "tu", "den", "tai", "trong",
    "ngoai", "tren", "duoi", "giua", "la", "cua", "cac", "mot", "nay", "do",
    "kia", "ay", "se", "da", "dang", "chua", "cung", "chi", "rat", "hon", "toi",
    "ban", "chung", "ho", "no", "moi", "tat", "ca", "khac", "neu", "khi", "dau",
    "gi", "ai", "sao", "su", "dung", "nguoi", "co", "the", "phai", "can", "de",
    "ma", "thi", "nen", "boi", "theo", "duoc", "bang", "ve", "ra", "vao", "ky",
    "nang", "cong", "cu", "tro", "ly",
  ],
  markers: ["nguoi", "khi", "duoc", "nhung", "cua", "trong", "hoac"],
  triggerSignals: [
    /\b(su\s+dung|dung|goi|ap\s+dung)\b[\s\S]{0,45}\b(khi|neu|truoc|sau)\b/,
    /\bkhi\s+(nguoi\s+dung|khach|ai\s+do|can|yeu\s+cau|muon|hoi)\b/,
    /\bmoi\s+khi\b/,
    /\b(truoc|sau)\s+khi\b/,
    /\bdung\s+cho\s+(cac\s+)?(tac\s+vu|yeu\s+cau|cau\s+hoi|truong\s+hop)\b/,
    /\bduoc\s+thiet\s+ke\s+(de|cho)\b/,
    /\btrong\s+truong\s+hop\b/,
    /\btruong\s+hop\s+su\s+dung\b/,
  ],
  firstPerson: [
    /^\s*(toi|minh)\b/,
    /\btoi\s+(co\s+the|se)\s+(giup|ho\s+tro)\b/,
    /\bban\s+co\s+the\s+su\s+dung\b/,
  ],
  samples: {
    triggers: [
      "Tạo báo cáo PDF từ tệp Markdown theo mẫu của công ty. Sử dụng khi người dùng yêu cầu một báo cáo có thể in hoặc muốn xuất ghi chú để in.",
      "Rà soát các thay đổi đã chuẩn bị để tìm lỗi và trường hợp biên bị bỏ sót. Dùng trước khi người dùng tạo commit, hoặc mỗi khi họ muốn xem lại diff lần nữa.",
    ],
    capabilityOnly: [
      "Cung cấp một bộ tiện ích đầy đủ cho việc xử lý tài liệu PDF và trích xuất các bảng bên trong.",
    ],
  },
};

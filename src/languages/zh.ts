import type { LanguagePack } from "./types.js";

/**
 * Chinese is indexed as overlapping character bigrams, so **the stopwords below
 * are bigrams** wherever the word is two characters (`使用`, `用户`) and single
 * characters where the tokenizer isolates one (`的`, `了`).
 *
 * Unlike Japanese there is no script boundary between grammar and content — it
 * is Han all the way — so bigrams do straddle word edges and produce fragments
 * (`当用`, `户请`). Those fragments appear in almost every description, so IDF
 * discounts them to nearly nothing; the entries here exist mainly to protect
 * `description-similarity`, which compares term sets directly.
 *
 * Simplified and traditional forms are both listed: skillcheck does not convert
 * between them, so a description written in either has to work as written.
 */
export const zh: LanguagePack = {
  code: "zh",
  name: "Chinese",
  endonym: "中文",
  scripts: ["han"],
  stopwords: [
    // Single characters the tokenizer isolates.
    "的", "了", "和", "与", "或", "在", "是", "有", "为", "对", "从", "到",
    "把", "被", "就", "都", "也", "很", "更", "这", "那", "你", "我", "他",
    "它", "们", "个", "中", "上", "下", "不", "会", "能", "可", "要", "请",
    "等", "及", "并", "但",
    // Two-character function words and domain noise.
    "使用", "用于", "用來", "用来", "可以", "能够", "能夠", "应该", "應該",
    "需要", "一个", "一個", "这个", "這個", "那个", "那個", "以及", "并且",
    "並且", "但是", "因为", "因為", "所以", "进行", "進行", "用户", "用戶",
    "使用者", "技能", "工具", "助手", "帮助", "幫助", "提供", "支持", "支援",
    "通过", "通過", "根据", "根據", "以便", "例如", "比如", "相关", "相關",
    "内容", "內容", "信息", "資訊", "操作", "功能", "自动", "自動",
  ],
  triggerSignals: [
    /当[^。；]{0,40}(时|時)/,
    /(在|於)[^。；]{0,30}(时候|時候|时|時)/,
    /(使用|適用|适用|用于|用於|调用|調用)(场景|場景|时机|時機|情况|情況|条件|條件)/,
    /(需要|想要|要求|请求|請求|希望|打算|准备|準備)[^。；]{0,20}(时|時)/,
    /(用户|用戶|使用者)[^。；]{0,25}(时|時|要求|请求|請求|询问|詢問|需要)/,
    /如果[^。；]{0,30}(就|则|則|请|請)?(使用|调用|調用)/,
    /(之前|之后|之後|期间|期間)(使用|调用|調用|运行|運行)/,
    /(适用于|適用於|用于|用於)[^。；]{0,20}(场景|場景|情况|情況|时|時|任务|任務|请求|請求)/,
    /(触发|觸發)/,
    /(什么时候|什麼時候)(使用|用)/,
    /(应在|應在)[^。；]{0,20}(时|時|使用)/,
  ],
  firstPerson: [
    /^(我|我们|我們)(可以|会|會|将|將|来|來)/,
    /我(可以|能|会|會)(帮|幫|协助|協助|为你|為你)/,
    /(你|您)可以(使用|用)(这个|這個|此)(技能|工具)/,
  ],
  samples: {
    triggers: [
      "使用公司模板将 Markdown 转换为可打印的 PDF 报告。当用户请求生成 PDF 文档或导出可打印的笔记时使用。",
      "审阅暂存的改动，找出缺陷和遗漏的边界情况。在用户提交 commit 之前调用，或者当他们要求再看一遍 diff 时使用。",
    ],
    capabilityOnly: [
      "提供一整套用于处理 PDF 文档以及抽取其中表格的实用程序。",
    ],
  },
};

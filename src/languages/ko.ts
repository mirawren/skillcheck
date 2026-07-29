import type { LanguagePack } from "./types.js";

/**
 * Korean does put spaces between phrases, but it also glues particles and
 * endings onto the stem — `보고서`, `보고서를`, `보고서에서` are the same word
 * to a reader and three different strings to an exact-match index. Bigrams
 * dissolve that: all three share `보고` and `고서`. It is the same treatment
 * Lucene's CJK analyzer gives Hangul, and the reason the stopwords below are
 * written as bigrams.
 */
export const ko: LanguagePack = {
  code: "ko",
  name: "Korean",
  endonym: "한국어",
  scripts: ["hangul"],
  stopwords: [
    // Verb endings and copula.
    "합니", "니다", "습니", "하는", "하기", "하여", "해서", "하고", "한다",
    "이다", "있는", "있습", "있을", "수있", "것을", "것이", "것은", "됩니",
    "된다", "되는", "하세", "세요", "십시", "시오",
    // Particles and connectives that survive as bigrams.
    "에서", "으로", "이나", "그리", "리고", "또는", "대해", "통해", "위해",
    "대한", "관련", "다음", "등을", "등의", "때에", "경우", "우에", "때는",
    // Domain noise.
    "사용", "용자", "기능", "도구", "스킬", "지원", "제공", "처리", "실행",
    "어시", "시스", "스턴", "턴트",
  ],
  triggerSignals: [
    /(때|경우|시)\s*에?\s*(사용|활용|호출|적용|실행)/,
    /(요청|요구|질문|문의|부탁)(할|하는|하면|했을|받으면)/,
    /사용하(세요|십시오|면|기|는)/,
    /(사용자|유저|고객)(가|이)\s*[^.]{0,25}(할|하면|요청|원할|물어)/,
    /(전|후|중)에\s*(사용|실행|호출)/,
    /(할|하는|필요한|원하는)\s*(때|경우)/,
    /언제\s*(사용|쓰)/,
    /(필요|원할|하고자)(할|하는|한)\s*(때|경우)/,
    /(트리거|사용\s*사례|활용\s*사례|사용\s*시점)/,
    /(적합|유용)합니다/,
  ],
  firstPerson: [
    /^(저는|제가|저희)/,
    /(도와드리|도와 드리|안내해 드리|알려드리)/,
    /(당신은|여러분은)\s*이\s*(스킬|기능)을\s*사용할\s*수/,
  ],
  samples: {
    triggers: [
      "Markdown 파일을 회사 템플릿의 PDF 보고서로 변환합니다. 사용자가 인쇄 가능한 보고서나 노트 내보내기를 요청할 때 사용하세요.",
      "스테이징된 변경 사항에서 버그와 놓친 경계 사례를 검토합니다. 사용자가 commit 하기 전에 사용하고, diff 를 다시 봐 달라고 요청하는 경우에도 사용합니다.",
    ],
    capabilityOnly: [
      "PDF 문서를 처리하고 그 안의 표를 추출하는 포괄적인 유틸리티 모음을 제공합니다.",
    ],
  },
};

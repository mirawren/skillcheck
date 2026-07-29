import type { LanguagePack } from "./types.js";

/**
 * Japanese, like the other scripts written without spaces, is indexed as
 * overlapping character bigrams — so **the stopwords below are bigrams too**,
 * because that is the form the tokenizer emits. `します` arrives as `しま` and
 * `ます`, and both have to be listed to suppress it.
 *
 * One property of the script does a lot of work for free: the tokenizer breaks
 * runs at script boundaries, and Japanese happens to put its content in kanji
 * and its grammar in hiragana. `PDFを作成` splits into `pdf`, `を`, `作成`
 * without anything here having to know a word from a particle.
 *
 * The remaining noise is inflectional kana, which is common enough that BM25's
 * IDF already discounts it to near zero. It is listed anyway because the
 * `description-similarity` rule compares raw term sets, where a shared `ます`
 * would otherwise read as two skills resembling each other.
 */
export const ja: LanguagePack = {
  code: "ja",
  name: "Japanese",
  endonym: "日本語",
  scripts: ["kana", "han"],
  stopwords: [
    // Particles, which the script split isolates as single characters.
    "の", "を", "に", "は", "が", "で", "と", "も", "や", "か", "ね", "よ", "へ",
    "から", "まで", "より", "など",
    // Inflection and copula, as bigrams.
    "しま", "ます", "ませ", "せん", "した", "して", "する", "され", "れる",
    "られ", "てい", "いま", "です", "でき", "きま", "なる", "なり", "ある",
    "あり", "いる", "たい", "よう", "うに", "ため", "こと", "もの", "とき",
    "ので", "という", "いう", "その", "この", "あの", "これ", "それ", "ここ",
    "てく", "くだ", "ださ", "さい", "った", "って", "また", "および",
    // Domain noise: true of nearly every skill, so it separates nothing.
    "使用", "利用", "実行", "処理", "対応", "スキ", "キル", "ツー", "ール",
    "エー", "ージ", "ジェ", "ェン", "ント", "ユー", "ーザ", "ーザー",
  ],
  triggerSignals: [
    /(とき|時|場合|際|ケース)に(?:は)?(使用|利用|使っ|呼び出|起動|適用|実行)/,
    /(を|が)(依頼|要求|要望|指示|希望|質問)(され|した|する|されたら|したら)/,
    /(使用|利用|実行)して(ください|下さい)/,
    /(する|したい|作成|生成|変換|確認|編集|修正|レビュー)(とき|時|場合|際)/,
    /(とき|時|場合|際)に(使|用|適|呼)/,
    /ユーザー?が[^。]{0,30}(とき|時|場合|際|たら)/,
    /(使いどころ|使うタイミング|利用シーン|使用場面|適用範囲)/,
    /(前|後)に(使用|利用|実行|呼び出)/,
    /(求められた|頼まれた|必要な|指定された)(とき|時|場合)/,
    /トリガー/,
    /^[^。]{0,60}(場合|とき|時)に/,
  ],
  firstPerson: [
    /^(私|僕|我々|こちら)(が|は|で)/,
    /(お手伝い|サポート|支援)(し|いた)(ます|します)/,
    /私が[^。]{0,20}(します|いたします)/,
  ],
  samples: {
    triggers: [
      "Markdown から PDF レポートを生成します。ユーザーが印刷用のドキュメント作成や PDF の生成を依頼したときに使用してください。",
      "ステージされた変更をレビューし、バグや見落とした境界ケースを洗い出します。コミットの前に使用し、diff をもう一度見たいと頼まれた場合にも使います。",
    ],
    capabilityOnly: [
      "PDF ドキュメントの操作と表の抽出を行う包括的なユーティリティ群を提供します。",
    ],
  },
};

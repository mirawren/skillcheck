import { pluginManifestInfo } from "../plugin-checks.js";
import type { Rule, RuleInfo } from "../types.js";
import { bodyNotEmpty } from "./body-not-empty.js";
import { bodySize } from "./body-size.js";
import { brokenReferences } from "./broken-references.js";
import { crossLanguageTrigger } from "./cross-language-trigger.js";
import { descriptionLength } from "./description-length.js";
import { descriptionSimilarity } from "./description-similarity.js";
import { descriptionThirdPerson } from "./description-third-person.js";
import { frontmatterValid } from "./frontmatter-valid.js";
import { nameFormat } from "./name-format.js";
import { noPlaceholders } from "./no-placeholders.js";
import { smartQuotes } from "./smart-quotes.js";
import { triggerShadowing } from "./trigger-shadowing.js";
import { unknownKeys } from "./unknown-keys.js";
import { whenToUse } from "./when-to-use.js";

/**
 * Rule execution order is also documentation order (README table, --help).
 * Add new rules here — see CONTRIBUTING.md for the 15-minute rule guide.
 */
export const rules: Rule[] = [
  frontmatterValid,
  nameFormat,
  descriptionLength,
  whenToUse,
  descriptionThirdPerson,
  descriptionSimilarity,
  triggerShadowing,
  crossLanguageTrigger,
  smartQuotes,
  bodyNotEmpty,
  bodySize,
  brokenReferences,
  noPlaceholders,
  unknownKeys,
];

/**
 * Everything skillcheck can report, for listing/explaining/documenting: the
 * runnable rules plus the plugin-manifest checks.
 */
export const catalog: RuleInfo[] = [...rules, pluginManifestInfo];

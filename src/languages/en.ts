import type { LanguagePack } from "./types.js";

export const en: LanguagePack = {
  code: "en",
  name: "English",
  endonym: "English",
  scripts: ["latin"],
  stopwords: [
    "a", "about", "above", "after", "again", "against", "all", "also", "am", "an",
    "and", "any", "are", "as", "at", "be", "because", "been", "before", "being",
    "below", "between", "both", "but", "by", "can", "cannot", "could", "did", "do",
    "does", "doing", "done", "down", "during", "each", "few", "for", "from",
    "further", "had", "has", "have", "having", "he", "her", "here", "hers", "him",
    "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself", "just",
    "let", "like", "make", "makes", "many", "may", "me", "might", "more", "most",
    "must", "my", "need", "needs", "no", "nor", "not", "now", "of", "off", "on",
    "once", "only", "or", "other", "our", "out", "over", "own", "per", "please",
    "same", "shall", "she", "should", "since", "so", "some", "such", "than",
    "that", "the", "their", "them", "then", "there", "these", "they", "this",
    "those", "through", "to", "too", "under", "until", "up", "us", "use", "used",
    "user", "users", "using", "very", "via", "want", "wants", "was", "we", "were",
    "what", "when", "whenever", "where", "which", "while", "who", "whom", "why",
    "will", "with", "would", "you", "your", "yours",
  ],
  triggerSignals: [
    /**
     * "use when", "use this when", "use this skill for", "use it before",
     * "You MUST use this before any creative work".
     *
     * The filler between the verb and the preposition is optional, because an
     * earlier version required literally `this skill` and so reported an
     * emphatic, unmistakable trigger as having none at all, at error severity.
     *
     * But only *pronoun* filler, and only temporal prepositions. A first attempt
     * allowed `the <word>` and added `for`/`in`, which read "Use the toolkit for
     * extracting tables" and "Provides a toolkit for use in data pipelines" as
     * triggers — five of six capability-only descriptions started passing, which
     * is the flagship rule switching itself off. Being too quiet is cheaper than
     * being wrong, but not at the price of the rule.
     */
    /\buse\s+(?:this|it)?\s*(?:skill\s+)?(when|whenever|if|before|after|during|any\s*time)\b/,
    /\bwhen\s+(the\s+user|a\s+user|you(?:'re|\s+are)?|asked|working|creating|writing|editing|debugging|reviewing|generating|building|handling)\b/,
    /\bwhenever\b/,
    /\bany\s*time\s+(the\s+user|a\s+user|you|someone)\b/,
    /\bfor\s+(tasks|questions|requests|situations|cases|workflows)\b/,
    /\btriggers?\s+(on|when)\b/,
    /\binvoke\s+(this|when)\b/,
    /\b(?:should|must)\s+be\s+(?:used|invoked)\b/,
    /\bapplies\s+when\b/,
    /\bhelps?\s+when\b/,
    /\bif\s+(the\s+user|a\s+user|you|asked)\b/,
    // Anthropic's authoring guidance recommends this wording outright — but tied
    // to the verb, not bare: "Proactively monitors the queue" is a capability.
    /\buse\s+(?:this\s+)?proactively\b/,
    /\bproactively\s+(when|whenever|after|before|if)\b/,
    /\bin\s+(?:response\s+to|situations\s+where|cases\s+where)\b/,
    // Temporal clauses that anchor the skill to a moment in the workflow
    // ("…before you commit", "…after merging", "…while debugging").
    /\b(before|after|while)\s+(you|the\s+user|a\s+user|committing|merging|releasing|deploying|debugging|reviewing)\b/,
  ],
  firstPerson: [
    // Opens in assistant voice: "I…", "I'll…", "We…", "Let me…".
    /^\s*(i|i'm|i'll|i've|we|we'll|we're|let me)\b/,
    // Classic offer phrasings anywhere in the description.
    /\b(i can|i will|i'll|let me)\s+(help|assist|show|guide|walk)\b/,
    // Second-person framing the doc also flags.
    /\byou can use this\b/,
  ],
  samples: {
    triggers: [
      "Converts Markdown files into printable PDF reports with a house template. Use when the user asks to generate a PDF, produce a printable document, or export notes for printing.",
      "Reviews staged changes for bugs and missed edge cases. Invoke this before the user commits, or whenever they ask for a second pass over a diff.",
      // Regression samples. Each of these was reported as having no trigger at
      // all, at error severity, by a shipped version of this rule.
      "Collaborative idea refinement through Socratic questioning. You MUST use this before any creative work - designing systems, writing plans, or exploring solutions.",
      "Summarises a long thread into decisions and owners. Use proactively after a discussion closes.",
    ],
    capabilityOnly: [
      "Provides a comprehensive set of utilities for manipulating PDF documents and extracting their tables.",
      // Regression samples. Broadening the patterns above to accept an emphatic
      // trigger once made all five of these pass — the flagship rule quietly
      // switching itself off, which is a worse outcome than the false positive
      // the broadening was meant to fix.
      "Provides a toolkit for use in data pipelines and ETL jobs.",
      "Use the toolkit for extracting tables from scanned documents.",
      "Proactively monitors the build queue and caches build artifacts.",
      "A library of helpers that should be applied consistently across the codebase.",
      "Automates deployment operations for this repository.",
    ],
  },
};

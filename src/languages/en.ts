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
    /\buse\s+(this\s+skill\s+)?(when|whenever|if|for|before|after|during)\b/,
    /\bwhen\s+(the\s+user|a\s+user|you(?:'re|\s+are)?|asked|working|creating|writing|editing|debugging|reviewing|generating|building|handling)\b/,
    /\bwhenever\b/,
    /\bfor\s+(tasks|questions|requests|situations|cases|workflows)\b/,
    /\btriggers?\s+(on|when)\b/,
    /\binvoke\s+(this|when)\b/,
    /\bshould\s+be\s+used\b/,
    /\bapplies\s+when\b/,
    /\bhelps?\s+when\b/,
    /\bif\s+(the\s+user|a\s+user|you|asked)\b/,
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
    ],
    capabilityOnly: [
      "Provides a comprehensive set of utilities for manipulating PDF documents and extracting their tables.",
    ],
  },
};

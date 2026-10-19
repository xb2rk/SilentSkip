/**
 * Shared keyword extraction for local (server-side) search over anchors and evidence.
 *
 * Deterministic: lowercase, punctuation stripped except `_./-` (identifiers and paths survive),
 * tokens of length >= 3, English + Vietnamese stopwords removed. Never a model call.
 */
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "what",
  "which",
  "when",
  "where",
  "why",
  "how",
  "did",
  "does",
  "done",
  "have",
  "has",
  "had",
  "are",
  "were",
  "was",
  "been",
  "being",
  "into",
  "over",
  "about",
  "tại",
  "sao",
  "cho",
  "của",
  "trong",
  "với",
  "được",
  "không",
  "những",
  "nào",
  "thế",
  "này",
  "đang",
  "thay",
  "đổi",
  "biến",
  "động",
  "kiểm",
  "tra",
]);

/** Extract search tokens from free text (deduplicated, order-preserving). */
export function extractKeywords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_./-]+/gu, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 3 && !STOPWORDS.has(token)),
    ),
  ];
}

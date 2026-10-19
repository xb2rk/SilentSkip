import type { FactIndex } from "../facts/fact-index.js";

export const QUOTE_PATTERN = /"([^"]{8,})"/gu;

/** Quotes that do not appear verbatim in the cited snippets. */
export function collectQuoteViolations(
  text: string,
  anchors: readonly string[],
  index: FactIndex,
): string[] {
  const snippets = anchors
    .map((anchorId) => index.anchors.get(anchorId)?.snippet ?? "")
    .map(normalizeWhitespace)
    .join("\n");
  const violations: string[] = [];
  for (const match of text.matchAll(QUOTE_PATTERN)) {
    const quote = match[1];
    if (quote === undefined) continue;
    if (!snippets.includes(normalizeWhitespace(quote))) violations.push(quote);
  }
  return violations;
}

/** Number of quoted spans in a text (denominator of the quote counter). */
export function countQuotes(text: string): number {
  return [...text.matchAll(QUOTE_PATTERN)].length;
}

/** Whitespace normalization used by quote checks. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

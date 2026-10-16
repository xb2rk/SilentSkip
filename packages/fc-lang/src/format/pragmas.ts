/**
 * Formatter ignore pragma parser (`// fc-format-ignore`, `/* fc-format-ignore-start * /`).
 *
 * @see README.md §Ignore Pragmas
 */

import { TokenId } from "../grammar/token-vocabulary.generated.js";
import type { Token } from "../lex/token.js";
import { isTrivia } from "../lex/trivia.js";

export interface IgnoreRange {
  readonly startOffset: number;
  readonly endOffset: number;
}

const LINE_IGNORE_PATTERN = /^\/\/\s*fc-format-ignore\b/u;
const BLOCK_IGNORE_START_PATTERN = /^\/\*\s*fc-format-ignore-start\b/u;
const BLOCK_IGNORE_END_PATTERN = /^\/\*\s*fc-format-ignore-end\b/u;

/**
 * Scans tokens to collect ignore ranges where verbatim source text should be preserved.
 */
export function collectIgnoreRanges(tokens: readonly Token[]): readonly IgnoreRange[] {
  const ranges: IgnoreRange[] = [];
  let blockStart: number | undefined;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;

    if (
      token.kind === TokenId.COMMENT ||
      token.kind === TokenId.COMMENT_NLSEMI
    ) {
      if (BLOCK_IGNORE_START_PATTERN.test(token.text)) {
        blockStart = token.range.start.offset;
      } else if (BLOCK_IGNORE_END_PATTERN.test(token.text) && blockStart !== undefined) {
        ranges.push({
          startOffset: blockStart,
          endOffset: token.range.end.offset,
        });
        blockStart = undefined;
      }
    } else if (
      (token.kind === TokenId.LINE_COMMENT || token.kind === TokenId.LINE_COMMENT_NLSEMI) &&
      LINE_IGNORE_PATTERN.test(token.text)
    ) {
      // Find the first non-trivia, non-comment token after this pragma
      let targetLine: number | undefined;
      let lineEndOffset = token.range.end.offset;

      for (let j = i + 1; j < tokens.length; j++) {
        const next = tokens[j];
        if (!next || next.kind === TokenId.EOF) break;

        // Skip leading trivia/comments between the pragma and target code
        if (targetLine === undefined) {
          if (isTrivia(next)) {
            continue;
          }
          targetLine = next.range.start.line;
        }

        if (next.range.start.line === targetLine || next.range.end.line === targetLine) {
          lineEndOffset = Math.max(lineEndOffset, next.range.end.offset);
        } else if (next.range.start.line > targetLine) {
          break;
        }
      }

      if (targetLine !== undefined) {
        ranges.push({
          startOffset: token.range.start.offset,
          endOffset: lineEndOffset,
        });
      }
    }
  }

  return ranges;
}

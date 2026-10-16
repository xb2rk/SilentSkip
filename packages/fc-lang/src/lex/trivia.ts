/**
 * Trivia classification for whitespace, comments, and JSDoc tokens.
 */

import { TokenId } from "../grammar/token-vocabulary.generated.js";
import type { Token } from "./token.js";

export type TriviaKind = "whitespace" | "line-comment" | "block-comment" | "jsdoc";

/**
 * Returns the trivia kind if the token is trivia, or undefined if significant.
 */
export function triviaKindOf(token: Token): TriviaKind | undefined {
  switch (token.kind) {
    case TokenId.WS:
    case TokenId.WS_NLSEMI:
      return "whitespace";
    case TokenId.LINE_COMMENT:
    case TokenId.LINE_COMMENT_NLSEMI:
      return "line-comment";
    case TokenId.COMMENT:
    case TokenId.COMMENT_NLSEMI:
      return token.text.startsWith("/**") ? "jsdoc" : "block-comment";
    default:
      return undefined;
  }
}

/**
 * Returns true if the token is whitespace or a comment.
 */
export function isTrivia(token: Token): boolean {
  return triviaKindOf(token) !== undefined;
}

/**
 * Returns true if the token contains at least one line break (`\n` or `\r`).
 */
export function containsLineBreak(token: Token): boolean {
  return token.text.includes("\r") || token.text.includes("\n");
}

/**
 * Returns true if the token is a comment (line, block, or JSDoc).
 */
export function isCommentToken(token: Token): boolean {
  const kind = triviaKindOf(token);
  return kind === "line-comment" || kind === "block-comment" || kind === "jsdoc";
}

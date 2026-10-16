/**
 * Reconstructs original source text from tokens to verify 100% lossless coverage.
 */

import { TokenId } from "../grammar/token-vocabulary.generated.js";
import type { Token } from "./token.js";

/**
 * Concatenates all non-EOF token texts.
 * In a lossless lexer, `reconstructSource(lex(s).tokens) === s` holds for all valid inputs.
 */
export function reconstructSource(tokens: readonly Token[]): string {
  return tokens
    .filter((token) => token.kind !== TokenId.EOF)
    .map((token) => token.text)
    .join("");
}

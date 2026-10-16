/**
 * Core token representation for the lossless FC lexer.
 */

import type { LexicalTokenId } from "../grammar/lexical.js";
import type { SourceRange } from "./position.js";

/**
 * An immutable, source-referential token.
 *
 * For non-EOF tokens, `text` contains the exact characters from the original source.
 * EOF is represented as a zero-width token with empty text.
 */
export interface Token {
  /** Numeric token ID defined in FCGLexer. */
  readonly kind: LexicalTokenId;
  /** Exact source range in the source string. */
  readonly range: SourceRange;
  /** Exact verbatim text slice from source. */
  readonly text: string;
}

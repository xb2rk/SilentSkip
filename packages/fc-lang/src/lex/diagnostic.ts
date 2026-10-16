/**
 * Lexical diagnostics reported during tokenization.
 */

import type { SourceRange } from "./position.js";

export type LexDiagnosticCode =
  | "unexpected-character"
  | "unterminated-block-comment"
  | "unterminated-interpreted-string"
  | "unterminated-raw-string"
  | "unterminated-rune";

/**
 * A recoverable lexical issue encountered during tokenization.
 * The lexer recovers by continuing scanning so tokens still cover 100% of the input.
 */
export interface LexDiagnostic {
  readonly code: LexDiagnosticCode;
  readonly message: string;
  readonly range: SourceRange;
}

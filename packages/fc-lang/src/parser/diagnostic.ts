/**
 * Parse diagnostics reported during AST construction.
 */

import type { SourceRange } from "../lex/position.js";

export type ParseDiagnosticCode =
  | "expected-expression"
  | "expected-name"
  | "expected-token"
  | "expected-type"
  | "unexpected-decorator"
  | "unexpected-token";

/**
 * A recoverable parse diagnostic. Invalid inputs are reported cleanly and
 * never silently dropped or corrupted.
 */
export interface ParseDiagnostic {
  readonly code: ParseDiagnosticCode;
  readonly message: string;
  readonly range: SourceRange;
}

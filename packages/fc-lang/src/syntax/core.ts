/**
 * Core AST node infrastructure for the FC language.
 */

import type { SourceRange } from "../lex/position.js";

/**
 * Half-open token indices `[start, end)` into the lossless token stream.
 */
export interface TokenIndexRange {
  /** Inclusive index of the first token in the token stream. */
  readonly start: number;
  /** Exclusive index of the last token in the token stream. */
  readonly end: number;
}

/**
 * Base interface for every syntax node in the Abstract Syntax Tree.
 * Every syntax node is source-referential and retains exact source and token bounds.
 */
export interface SyntaxNode {
  readonly kind: string;
  readonly range: SourceRange;
  readonly tokenRange: TokenIndexRange;
}

/**
 * An identifier name in source code.
 */
export interface NameNode extends SyntaxNode {
  readonly kind: "name";
  readonly text: string;
  readonly tokenIndex: number;
}

/**
 * A dot-separated qualified name (e.g. `Math.Vector3.Zero`).
 */
export interface QualifiedNameNode extends SyntaxNode {
  readonly kind: "qualified-name";
  readonly dotTokenIndices: readonly number[];
  readonly segments: readonly NameNode[];
  readonly text: string;
}

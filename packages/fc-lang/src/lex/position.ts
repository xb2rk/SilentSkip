/**
 * Source coordinate structures compatible with Language Server Protocol (LSP).
 */

/**
 * A zero-based UTF-16 source position.
 */
export interface SourcePosition {
  /** Zero-based absolute UTF-16 offset from the start of the file. */
  readonly offset: number;
  /** Zero-based line number. */
  readonly line: number;
  /** Zero-based column number within the line. */
  readonly column: number;
}

/**
 * A half-open source range `[start, end)`.
 */
export interface SourceRange {
  /** Inclusive start position. */
  readonly start: SourcePosition;
  /** Exclusive end position. */
  readonly end: SourcePosition;
}

/**
 * Formats a source position as a human-readable `line:column` string (1-based for editors).
 */
export function formatPosition(pos: SourcePosition): string {
  return `${pos.line + 1}:${pos.column + 1}`;
}

/**
 * Formats a source range as `startLine:startCol-endLine:endCol`.
 */
export function formatRange(range: SourceRange): string {
  return `${formatPosition(range.start)}-${formatPosition(range.end)}`;
}

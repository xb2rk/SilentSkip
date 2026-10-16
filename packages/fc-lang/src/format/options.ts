/**
 * User-configurable layout choices that preserve FC syntax and literal bytes.
 *
 * @see README.md §Configuration
 */

/** Line wrapping strategy for calls and collection literals. */
export type WrapMode = "never" | "auto" | "always";

/** End of line normalization strategy. */
export type EndOfLine = "auto" | "lf" | "crlf";

/** User-supplied formatter options. */
export interface FormatOptions {
  /** Optional file name used to deduce file kind (.fcc vs .fcg). */
  readonly fileName?: string;
  /** Explicit file kind override. */
  readonly fileKind?: "fcc" | "fcg";
  /** Target print width column limit before wrapping (default: 120). */
  readonly printWidth?: number;
  /** Number of spaces per indentation level (default: 2). */
  readonly tabWidth?: number;
  /** Indent lines with tabs instead of spaces (default: false). */
  readonly useTabs?: boolean;
  /** Print spaces around binary operators (default: true). */
  readonly spaceAroundOperators?: boolean;
  /** Print a space after commas (default: true). */
  readonly spaceAfterComma?: boolean;
  /** Wrapping behavior for function/method calls (default: "auto"). */
  readonly wrapCalls?: WrapMode;
  /** Wrapping behavior for struct/map/list collections (default: "auto"). */
  readonly wrapCollections?: WrapMode;
  /** Collapse consecutive blank lines to at most one empty line (default: true). */
  readonly collapseBlankLines?: boolean;
  /** Ensure formatted output ends with a newline character (default: true). */
  readonly insertFinalNewline?: boolean;
  /** Line ending normalization ("auto", "lf", or "crlf") (default: "auto"). */
  readonly endOfLine?: EndOfLine;
  /** Align `:` in map literals and `=` in struct literals across multiline entries (default: true). */
  readonly alignCompositeSeparators?: boolean;
  /** Print spaces inside brackets/braces (default: false). */
  readonly bracketSpacing?: boolean;
  /** Automatically sort file-header import blocks into standardized groups (default: true). */
  readonly sortImports?: boolean;
}

/** Fully resolved and validated formatter options with non-nullable defaults. */
export interface ResolvedFormatOptions {
  readonly printWidth: number;
  readonly tabWidth: number;
  readonly useTabs: boolean;
  readonly spaceAroundOperators: boolean;
  readonly spaceAfterComma: boolean;
  readonly wrapCalls: WrapMode;
  readonly wrapCollections: WrapMode;
  readonly collapseBlankLines: boolean;
  readonly insertFinalNewline: boolean;
  readonly endOfLine: EndOfLine;
  readonly alignCompositeSeparators: boolean;
  readonly bracketSpacing: boolean;
  readonly sortImports: boolean;
}

/**
 * Default formatting options adhering to Craftland Studio convention and industry standards.
 */
export const DEFAULT_FORMAT_OPTIONS: ResolvedFormatOptions = {
  printWidth: 120,
  tabWidth: 2,
  useTabs: false,
  spaceAroundOperators: true,
  spaceAfterComma: true,
  wrapCalls: "auto",
  wrapCollections: "auto",
  collapseBlankLines: true,
  insertFinalNewline: true,
  endOfLine: "lf",
  alignCompositeSeparators: true,
  bracketSpacing: false,
  sortImports: true,
};

/**
 * Normalizes public options so formatting has one deterministic fallback for invalid values.
 */
export function resolveFormatOptions(options: FormatOptions = {}): ResolvedFormatOptions {
  return {
    printWidth: positiveInteger(options.printWidth, DEFAULT_FORMAT_OPTIONS.printWidth, 20, 1000),
    tabWidth: positiveInteger(options.tabWidth, DEFAULT_FORMAT_OPTIONS.tabWidth, 1, 16),
    useTabs: options.useTabs ?? DEFAULT_FORMAT_OPTIONS.useTabs,
    spaceAroundOperators: options.spaceAroundOperators ?? DEFAULT_FORMAT_OPTIONS.spaceAroundOperators,
    spaceAfterComma: options.spaceAfterComma ?? DEFAULT_FORMAT_OPTIONS.spaceAfterComma,
    wrapCalls: resolveWrapMode(options.wrapCalls, DEFAULT_FORMAT_OPTIONS.wrapCalls),
    wrapCollections: resolveWrapMode(options.wrapCollections, DEFAULT_FORMAT_OPTIONS.wrapCollections),
    collapseBlankLines: options.collapseBlankLines ?? DEFAULT_FORMAT_OPTIONS.collapseBlankLines,
    insertFinalNewline: options.insertFinalNewline ?? DEFAULT_FORMAT_OPTIONS.insertFinalNewline,
    endOfLine: resolveEndOfLine(options.endOfLine, DEFAULT_FORMAT_OPTIONS.endOfLine),
    alignCompositeSeparators: options.alignCompositeSeparators ?? DEFAULT_FORMAT_OPTIONS.alignCompositeSeparators,
    bracketSpacing: options.bracketSpacing ?? DEFAULT_FORMAT_OPTIONS.bracketSpacing,
    sortImports: options.sortImports ?? DEFAULT_FORMAT_OPTIONS.sortImports,
  };
}

function positiveInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return value !== undefined && Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function resolveWrapMode(value: WrapMode | undefined, fallback: WrapMode): WrapMode {
  return value === "never" || value === "auto" || value === "always" ? value : fallback;
}

function resolveEndOfLine(value: EndOfLine | undefined, fallback: EndOfLine): EndOfLine {
  return value === "auto" || value === "lf" || value === "crlf" ? value : fallback;
}

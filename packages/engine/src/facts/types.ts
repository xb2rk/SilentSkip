/**
 * Fact model — the stable, serializable output of the E2.3 fact walkers.
 *
 * A `FactBundle` is a pure function of its inputs (sources + engine version): no clocks, no
 * randomness, no environment reads. It is persisted verbatim into `indexSnapshots` and every
 * later stage (delta, relations, journeys, digest) reads from it — never from the AST again.
 *
 * Coordinate conventions (identical to the CSV subsystem): 1-based lines, 0-based UTF-16
 * offsets, so every span maps 1:1 back into the file for UI anchors.
 */

/** Bump on any shape change; persisted snapshots are keyed by this value. */
export const FACT_SCHEMA_VERSION = 1;

/** A source span with 1-based lines and 0-based UTF-16 offsets. */
export interface FactSpan {
  /** 0-based UTF-16 offset of the span start within the file. */
  offset: number;
  /** Length of the span in UTF-16 code units. */
  length: number;
  /** 1-based physical line where the span starts. */
  line: number;
  /** 1-based physical line where the span ends (>= `line`). */
  endLine: number;
}

/** What kind of named declaration a symbol is. */
export type SymbolKind =
  | "define"
  | "alias"
  | "enum"
  | "enum-member"
  | "component"
  | "tuple"
  | "function"
  | "event"
  | "graph"
  | "declare-graph"
  | "field"
  | "variable"
  | "parameter"
  | "for-binding";

/**
 * Symbol scope class.
 * - `top`: top-level declaration (enum, tuple, function at file level, graph).
 * - `member`: named member of a scope (enum member, field, graph member function).
 * - `local`: function-local binding (variable, parameter, for binding).
 */
export type SymbolScope = "top" | "member" | "local";

/** A named declaration found in the syntax tree. */
export interface SymbolFact {
  /** Stable identity: `${path}#${name}@${nameStartOffset}`. Unique within a bundle. */
  id: string;
  /** Exact declared name (identifier text). */
  name: string;
  kind: SymbolKind;
  scope: SymbolScope;
  /** Enclosing named scope (enum, component, graph, function…), when there is one. */
  container?: string;
  /** Span of the whole declaration node. */
  span: FactSpan;
  /** Span of the name token itself — what a UI would underline. */
  nameSpan: FactSpan;
}

/** How a name reference was classified while walking. */
export type RefRole = "read" | "write" | "member";

/** Outcome of the name-level (not full-scope) resolution pass. */
export interface RefResolution {
  /** `resolved`: exactly one candidate at the most specific level; `ambiguous`: several; `unresolved`: none. */
  status: "resolved" | "ambiguous" | "unresolved";
  /** Level at which resolution succeeded (or where ambiguity was found). */
  level?: "local" | "member" | "top" | "import";
  /** Symbol id (or import id) when `status` is `resolved`. */
  resolvedId?: string;
  /** Candidate ids when `status` is `ambiguous`. */
  candidateIds?: string[];
}

/**
 * A name reference site. `name-expression` nodes are reads; assignment targets are writes;
 * `obj.member` accesses are member reads. Call callees appear both here and in `calls`.
 */
export interface RefFact {
  /** Exact identifier text at the site. */
  name: string;
  role: RefRole;
  /** Span of the identifier itself. */
  span: FactSpan;
  /** Enclosing named scope (nearest function/graph/member), when there is one. */
  container?: string;
  /** Name-level resolution result — foundation for relations, not itself a hard fact. */
  resolution: RefResolution;
}

/** A function invocation. */
export interface CallFact {
  /** Span of the whole call expression (callee + arguments). */
  span: FactSpan;
  /** Exact source slice of the callee expression (e.g. `Strings.Length`). */
  calleeText: string;
  /** Simple callee name for bare calls or member calls; absent for exotic callees. */
  calleeName?: string;
  /** Exact source slice of the receiver for member calls (e.g. `Strings`). */
  receiverText?: string;
  argumentCount: number;
  /** Scheduling prefix when the call is `start …` or `wait …`. */
  prefix?: "start" | "wait";
  /** Enclosing named scope at the call site. */
  container?: string;
}

/** A string literal occurrence — the raw material of CSV name-linking. */
export interface StringFact {
  span: FactSpan;
  /** Exact source text including delimiters and escapes. */
  rawText: string;
  /** Delimiters stripped, escapes kept as written (no unescaping — nothing is invented). */
  innerText: string;
}

/** An import statement. */
export interface ImportFact {
  /** Stable identity: `${path}#import@${startOffset}`. */
  id: string;
  kind: "library" | "named";
  /** Import path with quotes stripped (e.g. `Data/Example.fcg`). */
  path: string;
  /** Imported symbol name for named imports. */
  imported?: string;
  /** Alias introduced by `as`. */
  alias?: string;
  span: FactSpan;
}

/** A comment attached to the declaration that follows it. */
export interface DocCommentFact {
  kind: "jsdoc" | "block-comment" | "line-comment";
  /** Exact comment text including markers. */
  text: string;
  span: FactSpan;
  /** Symbol id the comment is attached to. */
  attachedTo: string;
}

/** Facts extracted from one source file. */
export interface FileFacts {
  /** Path as given by the caller (repo-relative, forward slashes by convention). */
  path: string;
  language: "fcc" | "fcg";
  /** Parser outcome — surfaced honestly instead of hidden. */
  parse: {
    /** Number of lexical diagnostics. */
    lexDiagnostics: number;
    /** Number of parse diagnostics. */
    diagnostics: number;
    /** True when the parser consumed the token stream through EOF. */
    consumedThroughEof: boolean;
  };
  symbols: SymbolFact[];
  refs: RefFact[];
  calls: CallFact[];
  strings: StringFact[];
  imports: ImportFact[];
  docComments: DocCommentFact[];
}

/** The complete fact set of one or more files. */
export interface FactBundle {
  schemaVersion: number;
  /** Sorted by `path` — deterministic regardless of input order. */
  files: FileFacts[];
}

/** One input file for `buildFactBundle`. */
export interface SourceInput {
  /** Repo-relative path (forward slashes); extension decides `.fcc` vs `.fcg` parsing. */
  path: string;
  /** Full file content. */
  source: string;
}

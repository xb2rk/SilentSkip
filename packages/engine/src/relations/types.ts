/**
 * Relation model — v1 of the syntax-graph edges the engine reasons over.
 *
 * Relations are *claims* derived from a `FactBundle` (never from raw text): every relation
 * carries the rule that produced it, the exact spans it connects, a confidence class and a
 * human-readable derivation chain ("why we think this"). Downstream rules (Value Journey,
 * checks) may only create hard findings from `exact` relations; `inferred` routes context
 * and suggestions; nothing is ever emitted as a guess — an unresolved site produces no
 * relation at all (its honesty lives in the fact bundle's resolution status).
 */

/** Bump on any shape change; persisted snapshots are keyed by this value. */
export const RELATIONS_SCHEMA_VERSION = 1;

/**
 * Confidence class of a relation.
 * - `exact`: the claim follows deterministically from the bundle with no name-level fallback
 *   (same-container resolution, literal statement facts, a literal filename match).
 * - `inferred`: a documented convention or fallback produced it (cross-container member
 *   fallback, import-alias receiver, path-suffix matching).
 * - `unknown`: reserved for later stages (e.g. a pinned binding); v1 never emits it.
 */
export type RelationConfidence = "exact" | "inferred" | "unknown";

/**
 * Stable rule identifiers. Each rule documents exactly how its relations are derived.
 * - `name-refers-to-symbol` — a resolved name reference targets a declared symbol.
 * - `name-refers-to-import` — a resolved name reference targets an import alias/name.
 * - `call-name-resolves` — a call's callee name resolves to a symbol (same ladder as refs).
 * - `call-receiver-import` — a member call's receiver matches an import alias/name.
 * - `import-statement` — a file imports a path (literal statement fact).
 * - `import-path-matches-file` — an import path suffix-matches exactly one bundle file.
 * - `string-names-csv` — a string literal names exactly one CSV table (channel ① of §4.5).
 * - `resource-enum-names-csv` — `EResCSV.<Name>` names exactly one CSV table (channel ②,
 *   only when the project profile enables editorGen indexing).
 */
export type RelationRuleId =
  | "name-refers-to-symbol"
  | "name-refers-to-import"
  | "call-name-resolves"
  | "call-receiver-import"
  | "import-statement"
  | "import-path-matches-file"
  | "string-names-csv"
  | "resource-enum-names-csv";

/** One side of a relation. */
export interface RelationEndpoint {
  /** Path of this endpoint — bundle-relative for bundle files, the raw import/CSV path otherwise. */
  file: string;
  /** Span of the endpoint (ref site, symbol name, string literal) when it has one. */
  span?: FactSpanLike;
  /** Symbol id when the endpoint is a symbol. */
  symbolId?: string;
  /** Import id when the endpoint is an import. */
  importId?: string;
}

/** Structural clone of the fact-layer span (kept local so relations stay self-contained). */
export interface FactSpanLike {
  offset: number;
  length: number;
  line: number;
  endLine: number;
}

/** A derived relation between two endpoints. */
export interface Relation {
  /** Deterministic id: `${ruleId}|${from.file}|${from span offset}|${target key}`. */
  id: string;
  ruleId: RelationRuleId;
  from: RelationEndpoint;
  to: RelationEndpoint;
  confidence: RelationConfidence;
  /** Ordered, human-readable derivation steps — the "why we think this" chain. */
  derivation: string[];
}

/** The complete relation set derived from one fact bundle. */
export interface RelationSet {
  schemaVersion: number;
  /** Sorted by `id` — deterministic regardless of input order. */
  relations: Relation[];
}

/** Extra context `buildRelations` needs beyond the bundle (kept explicit for purity). */
export interface RelationContext {
  /** Bundle-relative paths of the CSV tables known to the caller (may be empty). */
  csvPaths?: readonly string[];
  /** Treat `EResCSV.<Name>` member references as an exact CSV link (profile editorGenIndex). */
  editorGenIndex?: boolean;
}

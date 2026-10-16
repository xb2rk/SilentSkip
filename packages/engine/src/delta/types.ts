/**
 * DeltaBundle v1 — the deterministic A/B diff model.
 *
 * A delta reports only *differences*: files, symbols, imports and CSV rows that
 * were added, removed or changed between the two sides. Unchanged items are
 * omitted on purpose — the digest layer renders deltas, and the absence of an
 * entry is the honest "nothing moved here" statement.
 *
 * Identity rules (v1):
 * - A symbol is matched across refs by `kind + container + name`, not by offset —
 *   code that moved keeps its identity. When the same key repeats inside one
 *   file, occurrences are paired in source order.
 * - Container declarations (`graph`, `declare-graph`, `enum`, `component`,
 *   `tuple`) never appear as `changed`: their whole-subtree spans would report
 *   a change for every member edit. Their members surface individually instead.
 * - CSV rows are keyed by the trimmed first column ("first-column", marked
 *   *inferred* — PK inference is E7) and fall back to the stable row index when
 *   the value is empty or duplicated.
 */

import type { FactSpan, ImportFact, SourceInput, SymbolFact, SymbolKind } from "../facts/index.js";

/** Version of the delta JSON shape; bump when the structure changes. */
export const DELTA_SCHEMA_VERSION = 1;

/** Input pair for {@link buildDeltaBundle}: the raw sources of both refs. */
export interface DeltaInput {
  /** Sources of ref A (base). */
  readonly before: readonly SourceInput[];
  /** Sources of ref B (current). */
  readonly after: readonly SourceInput[];
}

/** A symbol that exists on both sides but whose source text differs. */
export interface SymbolChange {
  /** Stable match key: `kind|container|name`. */
  readonly key: string;
  readonly name: string;
  readonly kind: SymbolKind;
  readonly container?: string;
  /** Span of the declaration in ref A. */
  readonly beforeSpan: FactSpan;
  /** Span of the declaration in ref B. */
  readonly afterSpan: FactSpan;
  /** FNV-1a hash of the ref A source slice. */
  readonly beforeHash: string;
  /** FNV-1a hash of the ref B source slice. */
  readonly afterHash: string;
}

/** Per-file delta for one `.fcc`/`.fcg` script. */
export interface ScriptFileDelta {
  readonly path: string;
  readonly status: "added" | "removed" | "changed";
  readonly language: "fcc" | "fcg";
  /** Symbols present only in ref B. */
  readonly symbolsAdded: readonly SymbolFact[];
  /** Symbols present only in ref A. */
  readonly symbolsRemoved: readonly SymbolFact[];
  readonly symbolsChanged: readonly SymbolChange[];
  readonly importsAdded: readonly ImportFact[];
  readonly importsRemoved: readonly ImportFact[];
}

/** A CSV data row (header excluded) referenced by key, with a short preview. */
export interface CsvRowRef {
  /** Row key: trimmed first-column value, or `#row:<index>` fallback. */
  readonly key: string;
  readonly keyKind: "first-column" | "row-index";
  /** 0-based row index within the table (header row is index 0). */
  readonly rowIndex: number;
  /** 1-based source line of the row start. */
  readonly line: number;
  /** Raw row text, truncated to a preview when very long. */
  readonly text: string;
  /** True when {@link text} is a truncated preview of the raw row. */
  readonly truncated: boolean;
}

/** A CSV row present on both sides whose raw text differs. */
export interface CsvRowChange {
  readonly key: string;
  readonly keyKind: "first-column" | "row-index";
  readonly before: CsvRowRef;
  readonly after: CsvRowRef;
  /** 0-based column indexes whose raw cell text differs. */
  readonly columnsChanged: readonly number[];
}

/** Per-table delta for one `.csv` file. */
export interface CsvTableDelta {
  readonly path: string;
  readonly status: "added" | "removed" | "changed";
  /** True when the header row's raw text differs between the refs. */
  readonly headerChanged: boolean;
  readonly rowsAdded: readonly CsvRowRef[];
  readonly rowsRemoved: readonly CsvRowRef[];
  readonly rowsChanged: readonly CsvRowChange[];
}

/** The full A/B delta: script facts plus CSV tables, sorted by path. */
export interface DeltaBundle {
  readonly schemaVersion: typeof DELTA_SCHEMA_VERSION;
  readonly scripts: readonly ScriptFileDelta[];
  readonly tables: readonly CsvTableDelta[];
}

/**
 * DeltaBundle builder — pure and deterministic.
 *
 * Both sides are parsed through the same pipelines as the facts layer
 * ({@link buildFactBundle} for scripts, {@link parseCsv} for tables), then
 * matched by stable identity keys. Nothing is inferred beyond the documented
 * key rules; ambiguity (duplicate first-column values) degrades to the stable
 * row index instead of guessing.
 */

import type { CsvRow, CsvTable } from "../csv/index.js";
import { parseCsv } from "../csv/index.js";
import type { FileFacts, ImportFact, SourceInput, SymbolFact } from "../facts/index.js";
import { buildFactBundle } from "../facts/index.js";
import type {
  CsvRowChange,
  CsvRowRef,
  CsvTableDelta,
  DeltaBundle,
  DeltaInput,
  ScriptFileDelta,
  SymbolChange,
} from "./types.js";
import { DELTA_SCHEMA_VERSION } from "./types.js";

/** Container kinds whose whole-subtree spans would make `changed` noisy. */
const CONTAINER_KINDS = new Set(["graph", "declare-graph", "enum", "component", "tuple"]);

/** Maximum characters of a raw row kept in {@link CsvRowRef.text}. */
const ROW_PREVIEW_LIMIT = 160;

/**
 * Builds the A/B delta for the given sources.
 *
 * @param input - Raw sources of both refs; `.fcc`/`.fcg`/`.csv` only.
 * @throws Error on unsupported extensions or duplicate paths (caller bug —
 * both are silently catastrophic for matching, so they fail loudly).
 */
export function buildDeltaBundle(input: DeltaInput): DeltaBundle {
  const before = splitSources(input.before);
  const after = splitSources(input.after);
  const beforeFacts = factsByPath(before.scripts);
  const afterFacts = factsByPath(after.scripts);

  const scripts: ScriptFileDelta[] = [];
  const scriptPaths = new Set([...before.scripts.keys(), ...after.scripts.keys()]);
  for (const path of [...scriptPaths].sort()) {
    const b = beforeFacts.get(path);
    const a = afterFacts.get(path);
    if (b === undefined && a === undefined) continue;
    const delta =
      b === undefined && a !== undefined
        ? addedFile(path, a)
        : a === undefined && b !== undefined
          ? removedFile(path, b)
          : changedFile(
              path,
              b as FileFacts,
              a as FileFacts,
              before.scripts.get(path) as string,
              after.scripts.get(path) as string,
            );
    if (delta !== undefined) scripts.push(delta);
  }

  const tables: CsvTableDelta[] = [];
  const tablePaths = new Set([...before.tables.keys(), ...after.tables.keys()]);
  for (const path of [...tablePaths].sort()) {
    const b = before.tables.get(path);
    const a = after.tables.get(path);
    if (b === undefined && a === undefined) continue;
    const delta =
      b === undefined && a !== undefined
        ? addedTable(path, a)
        : a === undefined && b !== undefined
          ? removedTable(path, b)
          : changedTable(path, b as string, a as string);
    if (delta !== undefined) tables.push(delta);
  }

  return { schemaVersion: DELTA_SCHEMA_VERSION, scripts, tables };
}

/** Parses both sides into script and table sources, rejecting duplicates. */
function splitSources(sources: readonly SourceInput[]): {
  scripts: Map<string, string>;
  tables: Map<string, string>;
} {
  const scripts = new Map<string, string>();
  const tables = new Map<string, string>();
  for (const { path, source } of sources) {
    if (scripts.has(path) || tables.has(path)) {
      throw new Error(`Duplicate delta source path: ${path}`);
    }
    const lower = path.toLowerCase();
    if (lower.endsWith(".fcc") || lower.endsWith(".fcg")) {
      scripts.set(path, source);
    } else if (lower.endsWith(".csv")) {
      tables.set(path, source);
    } else {
      throw new Error(`Unsupported delta source extension: ${path}`);
    }
  }
  return { scripts, tables };
}

/** Builds facts for script sources and indexes them by path. */
function factsByPath(sources: Map<string, string>): Map<string, FileFacts> {
  const bundle = buildFactBundle(
    [...sources.entries()].map(([path, source]) => ({ path, source })),
  );
  return new Map(bundle.files.map((file) => [file.path, file]));
}

/** Detects the language from a script path; the caller guarantees the extension. */
function languageOf(path: string): "fcc" | "fcg" {
  return path.toLowerCase().endsWith(".fcc") ? "fcc" : "fcg";
}

/** Delta for a file that exists only in ref B. */
function addedFile(path: string, after: FileFacts): ScriptFileDelta {
  return {
    path,
    status: "added",
    language: languageOf(path),
    symbolsAdded: after.symbols,
    symbolsRemoved: [],
    symbolsChanged: [],
    importsAdded: after.imports,
    importsRemoved: [],
  };
}

/** Delta for a file that exists only in ref A. */
function removedFile(path: string, before: FileFacts): ScriptFileDelta {
  return {
    path,
    status: "removed",
    language: languageOf(path),
    symbolsAdded: [],
    symbolsRemoved: before.symbols,
    symbolsChanged: [],
    importsAdded: [],
    importsRemoved: before.imports,
  };
}

/** Delta for a file present on both sides; `undefined` when nothing changed. */
function changedFile(
  path: string,
  before: FileFacts,
  after: FileFacts,
  beforeSource: string,
  afterSource: string,
): ScriptFileDelta | undefined {
  const { symbolsAdded, symbolsRemoved, symbolsChanged } = diffSymbols(
    before.symbols,
    after.symbols,
    beforeSource,
    afterSource,
  );
  const { importsAdded, importsRemoved } = diffImports(before.imports, after.imports);
  const empty =
    symbolsAdded.length === 0 &&
    symbolsRemoved.length === 0 &&
    symbolsChanged.length === 0 &&
    importsAdded.length === 0 &&
    importsRemoved.length === 0;
  if (empty) return undefined;
  return {
    path,
    status: "changed",
    language: languageOf(path),
    symbolsAdded,
    symbolsRemoved,
    symbolsChanged,
    importsAdded,
    importsRemoved,
  };
}

/** Groups symbols by stable key, each group sorted by source offset. */
function groupSymbols(symbols: readonly SymbolFact[]): Map<string, SymbolFact[]> {
  const groups = new Map<string, SymbolFact[]>();
  for (const symbol of symbols) {
    const key = `${symbol.kind}|${symbol.container ?? ""}|${symbol.name}`;
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [symbol]);
    else list.push(symbol);
  }
  for (const list of groups.values()) {
    list.sort((x, y) => x.span.offset - y.span.offset);
  }
  return groups;
}

/** Matches symbols across refs and classifies added/removed/changed. */
function diffSymbols(
  before: readonly SymbolFact[],
  after: readonly SymbolFact[],
  beforeSource: string,
  afterSource: string,
): {
  symbolsAdded: SymbolFact[];
  symbolsRemoved: SymbolFact[];
  symbolsChanged: SymbolChange[];
} {
  const beforeGroups = groupSymbols(before);
  const afterGroups = groupSymbols(after);
  const keys = new Set([...beforeGroups.keys(), ...afterGroups.keys()]);
  const symbolsAdded: SymbolFact[] = [];
  const symbolsRemoved: SymbolFact[] = [];
  const symbolsChanged: SymbolChange[] = [];

  for (const key of [...keys].sort()) {
    const beforeList = beforeGroups.get(key) ?? [];
    const afterList = afterGroups.get(key) ?? [];
    const paired = Math.min(beforeList.length, afterList.length);
    for (let i = 0; i < paired; i++) {
      const b = beforeList[i];
      const a = afterList[i];
      if (b === undefined || a === undefined) break;
      if (CONTAINER_KINDS.has(b.kind)) continue;
      const beforeHash = hashSlice(beforeSource, b.span.offset, b.span.length);
      const afterHash = hashSlice(afterSource, a.span.offset, a.span.length);
      if (beforeHash === afterHash) continue;
      symbolsChanged.push({
        key,
        name: b.name,
        kind: b.kind,
        ...(b.container === undefined ? {} : { container: b.container }),
        beforeSpan: b.span,
        afterSpan: a.span,
        beforeHash,
        afterHash,
      });
    }
    for (const extra of beforeList.slice(paired)) symbolsRemoved.push(extra);
    for (const extra of afterList.slice(paired)) symbolsAdded.push(extra);
  }
  return { symbolsAdded, symbolsRemoved, symbolsChanged };
}

/** Stable import key: two imports are "the same" when kind, path and names match. */
function importKey(imp: ImportFact): string {
  return `${imp.kind}|${imp.path}|${imp.imported ?? ""}|${imp.alias ?? ""}`;
}

/** Compares import sets across refs. */
function diffImports(
  before: readonly ImportFact[],
  after: readonly ImportFact[],
): { importsAdded: ImportFact[]; importsRemoved: ImportFact[] } {
  const beforeKeys = new Map(before.map((imp) => [importKey(imp), imp]));
  const afterKeys = new Map(after.map((imp) => [importKey(imp), imp]));
  const importsAdded: ImportFact[] = [];
  const importsRemoved: ImportFact[] = [];
  for (const key of [...afterKeys.keys()].sort()) {
    if (!beforeKeys.has(key)) {
      const imp = afterKeys.get(key);
      if (imp !== undefined) importsAdded.push(imp);
    }
  }
  for (const key of [...beforeKeys.keys()].sort()) {
    if (!afterKeys.has(key)) {
      const imp = beforeKeys.get(key);
      if (imp !== undefined) importsRemoved.push(imp);
    }
  }
  return { importsAdded, importsRemoved };
}

/** Delta for a table that exists only in ref B. */
function addedTable(path: string, afterSource: string): CsvTableDelta {
  const table = parseCsv(afterSource);
  const counts = firstColumnCounts(table);
  return {
    path,
    status: "added",
    headerChanged: false,
    rowsAdded: table.rows.slice(1).map((row) => rowRef(row, rowKeyInfo(counts, row))),
    rowsRemoved: [],
    rowsChanged: [],
  };
}

/** Delta for a table that exists only in ref A. */
function removedTable(path: string, beforeSource: string): CsvTableDelta {
  const table = parseCsv(beforeSource);
  const counts = firstColumnCounts(table);
  return {
    path,
    status: "removed",
    headerChanged: false,
    rowsAdded: [],
    rowsRemoved: table.rows.slice(1).map((row) => rowRef(row, rowKeyInfo(counts, row))),
    rowsChanged: [],
  };
}

/** Delta for a table present on both sides; `undefined` when nothing changed. */
function changedTable(
  path: string,
  beforeSource: string,
  afterSource: string,
): CsvTableDelta | undefined {
  const before = parseCsv(beforeSource);
  const after = parseCsv(afterSource);
  const headerChanged = (before.rows[0]?.raw ?? "") !== (after.rows[0]?.raw ?? "");

  const beforeCounts = firstColumnCounts(before);
  const afterCounts = firstColumnCounts(after);
  const beforeRows = new Map<string, { row: CsvRow; info: RowKeyInfo }>();
  for (const row of before.rows.slice(1)) {
    const info = rowKeyInfo(beforeCounts, row);
    beforeRows.set(info.key, { row, info });
  }
  const afterRows = new Map<string, { row: CsvRow; info: RowKeyInfo }>();
  for (const row of after.rows.slice(1)) {
    const info = rowKeyInfo(afterCounts, row);
    afterRows.set(info.key, { row, info });
  }

  const rowsAdded: CsvRowRef[] = [];
  const rowsRemoved: CsvRowRef[] = [];
  const rowsChanged: CsvRowChange[] = [];
  const keys = new Set([...beforeRows.keys(), ...afterRows.keys()]);
  for (const key of [...keys].sort()) {
    const b = beforeRows.get(key);
    const a = afterRows.get(key);
    if (b === undefined && a !== undefined) {
      rowsAdded.push(rowRef(a.row, a.info));
    } else if (b !== undefined && a === undefined) {
      rowsRemoved.push(rowRef(b.row, b.info));
    } else if (b !== undefined && a !== undefined && b.row.raw !== a.row.raw) {
      rowsChanged.push({
        key,
        keyKind: a.info.keyKind,
        before: rowRef(b.row, b.info),
        after: rowRef(a.row, a.info),
        columnsChanged: changedColumns(b.row, a.row),
      });
    }
  }

  if (
    !headerChanged &&
    rowsAdded.length === 0 &&
    rowsRemoved.length === 0 &&
    rowsChanged.length === 0
  ) {
    return undefined;
  }
  rowsAdded.sort((x, y) => x.rowIndex - y.rowIndex);
  rowsRemoved.sort((x, y) => x.rowIndex - y.rowIndex);
  rowsChanged.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return { path, status: "changed", headerChanged, rowsAdded, rowsRemoved, rowsChanged };
}

/** Row-key classification for one data row of a table. */
interface RowKeyInfo {
  readonly key: string;
  readonly keyKind: "first-column" | "row-index";
}

/**
 * Counts trimmed first-column values across a table's data rows (header
 * excluded). Computed once per table so key classification stays O(n).
 */
function firstColumnCounts(table: CsvTable): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of table.rows.slice(1)) {
    const value = (row.cells[0]?.text ?? "").trim();
    if (value === "") continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/**
 * Computes the stable key of a data row: the trimmed first-column value when
 * it is non-empty and unique within the table, otherwise `#row:<index>`.
 */
function rowKeyInfo(counts: Map<string, number>, row: CsvRow): RowKeyInfo {
  const value = (row.cells[0]?.text ?? "").trim();
  if (value === "" || (counts.get(value) ?? 0) > 1) {
    return { key: `#row:${row.index}`, keyKind: "row-index" };
  }
  return { key: value, keyKind: "first-column" };
}

/** Builds the preview reference for a row. */
function rowRef(row: CsvRow, info: RowKeyInfo): CsvRowRef {
  const truncated = row.raw.length > ROW_PREVIEW_LIMIT;
  return {
    key: info.key,
    keyKind: info.keyKind,
    rowIndex: row.index,
    line: row.line,
    text: truncated ? row.raw.slice(0, ROW_PREVIEW_LIMIT) : row.raw,
    truncated,
  };
}

/** 0-based indexes of columns whose raw text differs between two rows. */
function changedColumns(before: CsvRow, after: CsvRow): number[] {
  const width = Math.max(before.cells.length, after.cells.length);
  const changed: number[] = [];
  for (let i = 0; i < width; i++) {
    if ((before.cells[i]?.raw ?? "") !== (after.cells[i]?.raw ?? "")) changed.push(i);
  }
  return changed;
}

/**
 * FNV-1a (32-bit) hash rendered as 8 hex chars — deterministic across
 * platforms and Node versions, unlike `crypto` digests that require imports
 * and async APIs this pure layer avoids.
 */
function hashSlice(source: string, offset: number, length: number): string {
  let hash = 0x811c9dc5;
  const end = Math.min(offset + length, source.length);
  for (let i = offset; i < end; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

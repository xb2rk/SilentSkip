/**
 * Silent-skip surface (E8.1) — what the runtime silently does to CSV data, proven per row.
 *
 * The engine only emits effects it can derive from facts; the effect itself is a runtime
 * convention unless pinned evidence removes the ambiguity:
 * - `length_guard`: a data row's width differs from the header. Loaders that guard on the column
 *   count may skip such rows; the skip is a documented runtime convention, so confidence is inferred.
 * - `parse_fail`: a cell that cannot parse as its declared type row (exact value/type mismatch);
 *   the loader may default the cell (convention).
 * - `duplicate_key`: two rows share the same pinned row key; last-wins loaders may overwrite the
 *   earlier one (convention). The collision itself is exact.
 *
 * Row identity is the table plus PK value (profile pin or first-column fallback), never the row
 * number. A row with no key uses `#line:<n>` as a witness-only identity.
 *
 * Not guessed: every surface below needs pinned intent. `nil_read`, `missing_binding`,
 * `enum_fallback` and `ref_broken` only appear when the project profile pins the reader
 * expectation (`readerProfile`) or a foreign-key override. `fixed_skip` is expected (the type
 * row) and is not a surface entry per spec §4.8.
 */

import type {
  SilentSkipEntry,
  SilentSkipMechanism,
  SilentSkipSide,
  SilentSkipSurface,
} from "@silentskip/contracts";
import type { CheckInput, CheckSide } from "../checks/types.js";
import type { CsvRow } from "../csv/index.js";
import {
  cellSpan,
  columnLabel,
  dataRows,
  detectTypeRow,
  failsDeclaredType,
  fkPins,
  isBlankRow,
  normalizeCastValue,
  resolveRowKey,
  rowKeyDisplay,
  rowKeyIsEmpty,
  rowKeyValue,
  rowSpan,
} from "../csv/index.js";

/** Entries kept per side; beyond this the surface is counted as truncated, never dropped silently. */
export const MAX_SURFACE_ENTRIES_PER_SIDE = 500;

/** Maximum duplicate-row witnesses attached to one duplicate-key entry. */
const MAX_DUPLICATE_WITNESSES = 5;

/** Mechanisms this wave can prove; the rest stay unknown until pinned intent exists. */
const PROVEN_MECHANISMS: readonly SilentSkipMechanism[] = [
  "length_guard",
  "parse_fail",
  "duplicate_key",
  "nil_read",
  "missing_binding",
  "enum_fallback",
  "ref_broken",
];

/** Runs the surface collector over both sides and computes the A/B delta. */
export function runSurfaces(input: CheckInput): SilentSkipSurface {
  const base = collectSide(input, "A");
  const current = collectSide(input, "B");
  const baseById = new Map(base.entries.map((entry) => [entry.id, entry] as const));
  const currentById = new Map(current.entries.map((entry) => [entry.id, entry] as const));

  const newSilent: SilentSkipEntry[] = [];
  const unchanged: SilentSkipEntry[] = [];
  for (const entry of current.entries) {
    if (baseById.has(entry.id)) unchanged.push(entry);
    else newSilent.push(entry);
  }
  const fixed: SilentSkipEntry[] = [];
  for (const entry of base.entries) {
    if (!currentById.has(entry.id)) fixed.push(entry);
  }

  const detected = new Set<SilentSkipMechanism>();
  for (const entry of [...newSilent, ...fixed, ...unchanged]) detected.add(entry.mechanism);

  return {
    base,
    current,
    delta: {
      newSilent: sortEntries(newSilent),
      fixed: sortEntries(fixed),
      unchanged: sortEntries(unchanged),
    },
    detectedMechanisms: [...detected].sort(),
    note: surfaceNote(detected, base.truncated + current.truncated),
  };
}

function collectSide(input: CheckInput, ref: "A" | "B"): SilentSkipSide {
  const side: CheckSide = ref === "A" ? input.base : input.current;
  const entries: SilentSkipEntry[] = [];
  let truncated = 0;
  const reader = input.profile?.readerProfile;
  const push = (entry: SilentSkipEntry): void => {
    if (entries.length >= MAX_SURFACE_ENTRIES_PER_SIDE) {
      truncated += 1;
      return;
    }
    entries.push(entry);
  };
  const enumMemberCache = new Map<string, ReadonlySet<string>>();
  const enumMembersOf = (name: string): ReadonlySet<string> | undefined => {
    const cached = enumMemberCache.get(name);
    if (cached !== undefined) return cached;
    const members = new Set<string>();
    let found = false;
    for (const facts of side.factsByPath.values()) {
      for (const symbol of facts.symbols) {
        if (symbol.kind === "enum" && symbol.name === name) found = true;
        if (symbol.kind === "enum-member" && symbol.container === name) members.add(symbol.name);
      }
    }
    if (!found) return undefined;
    enumMemberCache.set(name, members);
    return members;
  };

  for (const path of [...side.tables.keys()].sort()) {
    const table = side.tables.get(path);
    if (table === undefined) continue;
    const header = table.rows[0];
    if (header === undefined) continue;
    const typeRow = detectTypeRow(table);
    const dataRows = table.rows.filter(
      (row) => row.index !== 0 && row !== typeRow && !isBlankRow(row),
    );
    const resolution = resolveRowKey(table, path, input.profile);
    const keyOf = (row: CsvRow): string => {
      if (resolution?.kind === "resolved") {
        const value = rowKeyValue(row, resolution.columns);
        if (!rowKeyIsEmpty(value)) return value;
      }
      return `#line:${row.line}`;
    };
    const headerAnchor = input.registerAnchor(ref, path, rowSpan(header), "csv");

    // missing_binding — a pinned name binding expects a column the header does not have.
    const headerNames = new Set(header.cells.map((cell) => cell.text.trim()));
    const seenMissing = new Set<string>();
    for (const binding of reader?.bindings ?? []) {
      if (binding.csvPath !== path) continue;
      for (const pinned of binding.columns) {
        const column = pinned.trim();
        if (column === "" || headerNames.has(column) || seenMissing.has(column)) continue;
        seenMissing.add(column);
        push({
          id: entryId(path, "", "missing_binding", column),
          ref,
          table: path,
          rowKey: "",
          column,
          mechanism: "missing_binding",
          effect: "disabled",
          confidence: "exact",
          detail: `The pinned name binding expects column "${column}" but the header has no such column; a name lookup may disable the whole table before reading rows (runtime convention, inferred effect).`,
          anchors: [headerAnchor],
        });
      }
    }

    // nil_read — a pinned column whose empty cell makes the loader disable the row.
    const nilColumns = new Set<number>();
    for (const nilRead of reader?.nilReads ?? []) {
      if (nilRead.csvPath !== path) continue;
      const index = header.cells.findIndex((cell) => cell.text.trim() === nilRead.column);
      if (index < 0 || nilColumns.has(index)) continue;
      nilColumns.add(index);
      for (const row of dataRows) {
        const value = row.cells[index]?.text.trim() ?? "";
        if (value !== "") continue;
        const rowKey = keyOf(row);
        push({
          id: entryId(path, rowKey, "nil_read", nilRead.column),
          ref,
          table: path,
          rowKey,
          column: nilRead.column,
          mechanism: "nil_read",
          effect: "disabled",
          confidence: "exact",
          detail: `Column "${nilRead.column}" is empty on row ${row.line}; the loader may treat the row as disabled or skip it (runtime convention, inferred effect).`,
          anchors: [headerAnchor, input.registerAnchor(ref, path, rowSpan(row), "csv")],
        });
      }
    }

    // enum_fallback — a pinned enum-name column whose value is not a member.
    const enumColumns = new Set<string>();
    for (const fallback of reader?.enumFallbacks ?? []) {
      if (fallback.csvPath !== path) continue;
      const index = header.cells.findIndex((cell) => cell.text.trim() === fallback.column);
      if (index < 0) continue;
      const cacheKey = `${fallback.column}|${fallback.enumName}`;
      if (enumColumns.has(cacheKey)) continue;
      const members = enumMembersOf(fallback.enumName);
      if (members === undefined) continue;
      enumColumns.add(cacheKey);
      for (const row of dataRows) {
        const value = row.cells[index]?.text.trim() ?? "";
        if (value === "" || members.has(value)) continue;
        const rowKey = keyOf(row);
        const cell = row.cells[index];
        push({
          id: entryId(path, rowKey, "enum_fallback", fallback.column),
          ref,
          table: path,
          rowKey,
          column: fallback.column,
          mechanism: "enum_fallback",
          effect: "fallback",
          confidence: "exact",
          detail: `"${value}" in column "${fallback.column}" is not a member of enum ${fallback.enumName}; the loader may fall back to a default (runtime convention, inferred effect).`,
          anchors: [
            headerAnchor,
            ...(cell === undefined ? [] : [input.registerAnchor(ref, path, cellSpan(cell), "csv")]),
          ],
        });
      }
    }

    // length_guard — raw row width vs header width.
    for (const row of dataRows) {
      if (row.cells.length === header.cells.length) continue;
      const rowKey = keyOf(row);
      push({
        id: entryId(path, rowKey, "length_guard", null),
        ref,
        table: path,
        rowKey,
        column: null,
        mechanism: "length_guard",
        effect: "skipped",
        confidence: "inferred",
        detail: `Row ${row.line} has ${row.cells.length} cell(s) but the header has ${header.cells.length}; a length guard may skip the row (runtime convention, inferred).`,
        anchors: [headerAnchor, input.registerAnchor(ref, path, rowSpan(row), "csv")],
      });
    }

    // parse_fail — declared type row vs the real cell value.
    if (typeRow !== undefined) {
      const declared = typeRow.cells.map((cell) => cell.text.trim().toLowerCase());
      const typeAnchor = input.registerAnchor(ref, path, rowSpan(typeRow), "csv");
      for (const row of dataRows) {
        for (let index = 0; index < declared.length; index++) {
          const cell = row.cells[index];
          const type = declared[index];
          if (cell === undefined || type === undefined) continue;
          const value = cell.text.trim();
          if (value === "") continue;
          if (!failsDeclaredType(type, value)) continue;
          const rowKey = keyOf(row);
          const column = columnLabel(table, index);
          push({
            id: entryId(path, rowKey, "parse_fail", column),
            ref,
            table: path,
            rowKey,
            column,
            mechanism: "parse_fail",
            effect: "defaulted",
            confidence: resolution?.kind === "resolved" && resolution.exact ? "exact" : "inferred",
            detail: `"${value}" in column "${column}" does not parse as ${type}; the loader may default the cell (parse_fail, inferred effect).`,
            anchors: [typeAnchor, input.registerAnchor(ref, path, cellSpan(cell), "csv")],
          });
        }
      }
    }

    // duplicate_key — only a pinned key proves which rows collide; the first-column
    // fallback is a candidate key, not an identity (composite rows look duplicated).
    if (resolution?.kind === "resolved" && resolution.exact) {
      const firstByKey = new Map<string, CsvRow>();
      const duplicates = new Map<string, CsvRow[]>();
      for (const row of dataRows) {
        const key = rowKeyValue(row, resolution.columns);
        if (rowKeyIsEmpty(key)) continue;
        const first = firstByKey.get(key);
        if (first === undefined) {
          firstByKey.set(key, row);
          continue;
        }
        const rows = duplicates.get(key) ?? [];
        rows.push(row);
        duplicates.set(key, rows);
      }
      for (const [key, rows] of duplicates) {
        const all = [firstByKey.get(key), ...rows].filter(
          (row): row is CsvRow => row !== undefined,
        );
        const witnesses = all.slice(0, MAX_DUPLICATE_WITNESSES);
        push({
          id: entryId(path, key, "duplicate_key", null),
          ref,
          table: path,
          rowKey: key,
          column: null,
          mechanism: "duplicate_key",
          effect: "last_wins",
          confidence: "exact",
          detail: `${all.length} row(s) share the pinned key "${rowKeyDisplay(key)}" (lines ${all.map((row) => row.line).join(", ")}); last-wins loaders may keep only the last row (inferred effect).`,
          anchors: [
            headerAnchor,
            ...witnesses.map((row) => input.registerAnchor(ref, path, rowSpan(row), "csv")),
          ],
        });
      }
    }
  }

  // ref_broken — pinned FK values with no target row under the runtime cast.
  for (const pin of fkPins(input.profile)) {
    if (pin.cast === "unknown") continue;
    const sourceTable = side.tables.get(pin.sourcePath);
    const targetTable = side.tables.get(pin.targetPath);
    if (sourceTable === undefined || targetTable === undefined) continue;
    const sourceHeader = sourceTable.rows[0];
    const targetHeader = targetTable.rows[0];
    if (sourceHeader === undefined || targetHeader === undefined) continue;
    const sourceColumn = sourceHeader.cells.findIndex(
      (cell) => cell.text.trim() === pin.sourceColumn,
    );
    if (sourceColumn < 0) continue;
    const targetKey = resolveRowKey(targetTable, pin.targetPath, input.profile);
    if (targetKey === undefined || targetKey.kind !== "resolved" || !targetKey.exact) continue;
    if (targetKey.columns.length !== 1) continue;

    const targetKeys = new Set<string>();
    for (const row of dataRows(targetTable)) {
      const raw = rowKeyValue(row, targetKey.columns);
      if (rowKeyIsEmpty(raw)) continue;
      const normalized = normalizeCastValue(raw, pin.cast);
      if (normalized !== undefined) targetKeys.add(normalized);
    }
    const sourceResolution = resolveRowKey(sourceTable, pin.sourcePath, input.profile);
    const headerAnchor = input.registerAnchor(ref, pin.sourcePath, rowSpan(sourceHeader), "csv");
    for (const row of dataRows(sourceTable)) {
      const raw = row.cells[sourceColumn]?.text.trim() ?? "";
      if (raw === "") continue;
      const normalized = normalizeCastValue(raw, pin.cast);
      if (normalized !== undefined && targetKeys.has(normalized)) continue;
      const rowKey =
        sourceResolution?.kind === "resolved"
          ? rowKeyValue(row, sourceResolution.columns) || `#line:${row.line}`
          : `#line:${row.line}`;
      const cell = row.cells[sourceColumn];
      push({
        id: entryId(pin.sourcePath, rowKey, "ref_broken", pin.sourceColumn),
        ref,
        table: pin.sourcePath,
        rowKey,
        column: pin.sourceColumn,
        mechanism: "ref_broken",
        effect: "fallback",
        confidence: "exact",
        detail: `"${raw}" in ${pin.sourcePath}."${pin.sourceColumn}" has no row in ${pin.targetPath} under cast ${pin.cast}; the loader may fall back or ignore it (runtime convention, inferred effect).`,
        anchors: [
          headerAnchor,
          ...(cell === undefined
            ? []
            : [input.registerAnchor(ref, pin.sourcePath, cellSpan(cell), "csv")]),
        ],
      });
    }
  }

  return { ref, entries: sortEntries(entries), truncated };
}

function entryId(
  table: string,
  rowKey: string,
  mechanism: SilentSkipMechanism,
  column: string | null,
): string {
  return `${table}|${rowKey}|${mechanism}|${column ?? ""}`;
}

function sortEntries(entries: SilentSkipEntry[]): SilentSkipEntry[] {
  return [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function surfaceNote(detected: ReadonlySet<SilentSkipMechanism>, truncated: number): string {
  const parts = [
    detected.size === 0
      ? "Observed mechanisms: none. The engine can prove length_guard, parse_fail and duplicate_key from CSV shape, and nil_read, missing_binding, enum_fallback and ref_broken when pinned reader intent exists; fixed_skip is expected (type row) and is not counted."
      : `Observed mechanisms: ${[...detected].sort().join(", ")}. The engine can also prove ${PROVEN_MECHANISMS.filter((mechanism) => !detected.has(mechanism)).join(", ") || "no other mechanisms"} when the facts and pinned intent exist; fixed_skip is expected (type row) and is not counted.`,
    "Runtime effects of inferred surfaces stay conventions, not facts; nil_read, missing_binding, enum_fallback and ref_broken are emitted only from readerProfile pins or pin-fk overrides.",
  ];
  if (truncated > 0) {
    parts.push(
      `${truncated} entr(ies) were omitted beyond the per-side cap of ${MAX_SURFACE_ENTRIES_PER_SIDE}.`,
    );
  }
  return parts.join(" ");
}

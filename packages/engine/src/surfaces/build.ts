/**
 * Silent-skip surface (E8.1) — what the runtime silently does to CSV data, proven per row.
 *
 * The engine only emits effects it can derive from facts:
 * - `length_guard`: a data row's width differs from the header. Loaders that guard on the column
 *   count skip such rows; the skip is a documented runtime convention, so confidence is inferred.
 * - `parse_fail`: a cell that cannot parse as its declared type row (exact value/type mismatch).
 * - `duplicate_key`: two rows share the same row key; last-wins loaders overwrite the earlier one.
 *
 * Row identity is the table plus PK value (profile pin or first-column fallback), never the row
 * number. A row with no key uses `#line:<n>` as a witness-only identity.
 *
 * Not guessed here: `nil_read`, `missing_binding`, `enum_fallback`, `ref_broken` need pinned
 * loader/foreign-key intent and land in E8.2. `fixed_skip` is expected (the type row) and is not a
 * surface entry per spec §4.8.
 */

import type {
  SilentSkipEntry,
  SilentSkipMechanism,
  SilentSkipSide,
  SilentSkipSurface,
} from "@craftland-qa/contracts";
import type { CheckInput, CheckSide } from "../checks/types.js";
import type { CsvRow } from "../csv/index.js";
import {
  cellSpan,
  columnLabel,
  detectTypeRow,
  failsDeclaredType,
  isBlankRow,
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

/** Mechanisms this wave can prove; the rest need E8.2 intent. */
const PROVEN_MECHANISMS: readonly SilentSkipMechanism[] = [
  "length_guard",
  "parse_fail",
  "duplicate_key",
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

    const push = (entry: SilentSkipEntry): void => {
      if (entries.length >= MAX_SURFACE_ENTRIES_PER_SIDE) {
        truncated += 1;
        return;
      }
      entries.push(entry);
    };

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
        detail: `Row ${row.line} has ${row.cells.length} cell(s) but the header has ${header.cells.length}; a length guard skips the row (runtime convention).`,
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
            detail: `"${value}" in column "${column}" does not parse as ${type}; the loader defaults the cell (parse_fail).`,
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
          detail: `${all.length} row(s) share the pinned key "${rowKeyDisplay(key)}" (lines ${all.map((row) => row.line).join(", ")}); last-wins loaders keep only the last row.`,
          anchors: [
            headerAnchor,
            ...witnesses.map((row) => input.registerAnchor(ref, path, rowSpan(row), "csv")),
          ],
        });
      }
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
      ? "Observed mechanisms: none. The engine can prove length_guard, parse_fail and duplicate_key when the facts occur; fixed_skip is expected (type row) and is not counted."
      : `Observed mechanisms: ${[...detected].sort().join(", ")}. The engine can also prove ${PROVEN_MECHANISMS.filter((mechanism) => !detected.has(mechanism)).join(", ") || "no other mechanisms"} when the facts occur; fixed_skip is expected (type row) and is not counted.`,
    "nil_read, missing_binding, enum_fallback and ref_broken need pinned loader/FK intent (E8.2) and are not guessed.",
  ];
  if (truncated > 0) {
    parts.push(
      `${truncated} entr(ies) were omitted beyond the per-side cap of ${MAX_SURFACE_ENTRIES_PER_SIDE}.`,
    );
  }
  return parts.join(" ");
}

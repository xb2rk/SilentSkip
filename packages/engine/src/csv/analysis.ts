/**
 * CSV table analysis shared by checks and the silent-skip surface.
 *
 * Everything here is a pure read over a parsed `CsvTable`: spans keep the raw coordinates,
 * the type row is detected by the FC type vocabulary only, and row keys come from a profile pin
 * or the documented first-column fallback. Checks and surfaces must agree on these conventions,
 * so the logic lives in exactly one module.
 */

import type { ProjectProfile } from "@craftland-qa/contracts";
import type { FactSpan } from "../facts/types.js";
import type { CsvCell, CsvRow, CsvTable } from "./types.js";

/** The FC type vocabulary that may appear in a CSV type row — the format axiom. */
export const FC_TYPE_NAMES = new Set(["int", "int64", "float", "string", "bool"]);

/** Source span of a whole CSV record. */
export function rowSpan(row: CsvRow): FactSpan {
  return { offset: row.offset, length: row.length, line: row.line, endLine: row.endLine };
}

/** Source span of one CSV cell (multi-line quoted cells keep their real end line). */
export function cellSpan(cell: CsvCell): FactSpan {
  return {
    offset: cell.offset,
    length: cell.length,
    line: cell.line,
    endLine: cell.line + countLineBreaks(cell.raw),
  };
}

/** Counts line breaks the way a reader sees lines: \r\n counts once. */
function countLineBreaks(raw: string): number {
  let count = 0;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (char === "\r") {
      count += 1;
      if (raw[index + 1] === "\n") index += 1;
    } else if (char === "\n") {
      count += 1;
    }
  }
  return count;
}

/** A row with no content at all (blank line) — structure, not data. */
export function isBlankRow(row: CsvRow): boolean {
  return row.cells.every((cell) => cell.text.trim() === "");
}

/** The type row is row index 1 when every non-empty cell is an FC type name. */
export function detectTypeRow(table: CsvTable): CsvRow | undefined {
  const row = table.rows[1];
  if (row === undefined) return undefined;
  let nonEmpty = 0;
  for (const cell of row.cells) {
    const text = cell.text.trim().toLowerCase();
    if (text === "") continue;
    if (!FC_TYPE_NAMES.has(text)) return undefined;
    nonEmpty += 1;
  }
  return nonEmpty > 0 ? row : undefined;
}

/** Header label of a column, or `#index` when the header is missing/empty. */
export function columnLabel(table: CsvTable, index: number): string {
  const header = table.rows[0];
  const text = header?.cells[index]?.text.trim() ?? "";
  return text === "" ? `#${index}` : text;
}

const INT_PATTERN = /^-?\d+$/u;
const BOOLEAN_VALUES = new Set(["0", "1", "true", "false"]);

/**
 * True when a non-empty value cannot parse as the declared FC type. Unknown type names stay
 * parseable (the engine has no vocabulary entry to judge them by).
 */
export function failsDeclaredType(declared: string, value: string): boolean {
  if (declared === "int" || declared === "int64") return !INT_PATTERN.test(value);
  if (declared === "float") return !Number.isFinite(Number(value));
  if (declared === "bool") return !BOOLEAN_VALUES.has(value.toLowerCase());
  return false;
}

/** Separator between composite row-key parts; never rendered raw (use `rowKeyDisplay`). */
export const ROW_KEY_SEPARATOR = "\u001f";

/** Resolved row-key columns; one column for a simple key, several for a composite pin. */
export function rowKeyValue(row: CsvRow, columns: readonly number[]): string {
  return columns.map((column) => row.cells[column]?.text.trim() ?? "").join(ROW_KEY_SEPARATOR);
}

/** True when every component of a composite key is empty. */
export function rowKeyIsEmpty(value: string): boolean {
  return value.split(ROW_KEY_SEPARATOR).every((part) => part === "");
}

/** Human-readable composite key for findings, surfaces and the UI. */
export function rowKeyDisplay(value: string): string {
  return value.split(ROW_KEY_SEPARATOR).join(" | ");
}

/** Header labels of the pinned key columns, comma-joined for prose. */
export function rowKeyLabels(table: CsvTable, columns: readonly number[]): string {
  return columns.map((column) => columnLabel(table, column)).join(", ");
}

/** Row-key resolution of one table side. */
export type RowKeyResolution =
  | {
      readonly kind: "resolved";
      readonly columns: readonly number[];
      readonly exact: boolean;
      readonly note: string;
    }
  | { readonly kind: "pin-missing"; readonly columns: readonly string[] };

/**
 * Resolves the PK columns of a table: a `pin-row-key` override wins (exact). The value is a
 * comma-separated header list, so composite keys (`ItemId,SortOrder`) are representable. Without
 * a pin the first column is the documented inferred convention. A pin that points at missing
 * headers is reported rather than silently ignored.
 */
export function resolveRowKey(
  table: CsvTable,
  path: string,
  profile: ProjectProfile | undefined,
): RowKeyResolution | undefined {
  const pin = profile?.overrides.find(
    (override) =>
      override.kind === "pin-row-key" &&
      override.target.csvPath === path &&
      override.value !== undefined &&
      override.value.trim() !== "",
  );
  if (pin !== undefined) {
    const wanted = (pin.value ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
    const header = table.rows[0];
    if (header === undefined || wanted.length === 0) {
      return { kind: "pin-missing", columns: wanted };
    }
    const columns: number[] = [];
    const missing: string[] = [];
    for (const name of wanted) {
      const column = header.cells.findIndex((cell) => cell.text.trim() === name);
      if (column >= 0) columns.push(column);
      else missing.push(name);
    }
    if (missing.length > 0) return { kind: "pin-missing", columns: missing };
    return {
      kind: "resolved",
      columns,
      exact: true,
      note: `Row key pinned to column(s) ${wanted.map((name) => `"${name}"`).join(", ")} via a project profile override (pin-row-key).`,
    };
  }
  const header = table.rows[0];
  if (header === undefined || header.cells.length === 0) return undefined;
  return {
    kind: "resolved",
    columns: [0],
    exact: false,
    note: `No row key pinned - the first column ("${columnLabel(table, 0)}") is used as the key (documented inferred convention).`,
  };
}

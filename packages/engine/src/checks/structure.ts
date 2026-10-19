import {
  cellSpan,
  detectTypeRow,
  isBlankRow,
  resolveRowKey,
  rowKeyDisplay,
  rowKeyIsEmpty,
  rowKeyLabels,
  rowKeyValue,
  rowSpan,
} from "../csv/analysis.js";
import type { CsvRow, CsvTable } from "../csv/index.js";
import type { CheckFinding, CheckInput, CheckSide, RegisterAnchor } from "./types.js";

/** Maximum mismatching-row witnesses attached to one STRUCT-01 finding. */
const MAX_WIDTH_WITNESSES = 10;

/** Maximum row witnesses attached to one STRUCT-02 finding. */
const MAX_KEY_WITNESSES = 8;

/** Maximum cell witnesses attached to one STRUCT-03 finding. */
const MAX_CELL_WITNESSES = 8;

/** Maximum position witnesses attached to one DRIFT-01 finding. */
const MAX_DRIFT_WITNESSES = 6;

/**
 * Invisible characters a header cell should never carry: control codes, zero-width marks and the
 * BOM. Accented letters (Vietnamese, CJK, …) are legitimate header text and are NOT flagged.
 */
function hasHiddenChar(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
    if (
      code === 0x200b ||
      code === 0x200c ||
      code === 0x200d ||
      code === 0x2060 ||
      code === 0xfeff
    ) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// STRUCT-01 — row width differs from the header
// ---------------------------------------------------------------------------------------------

/** Row-width analysis of one table side. */
interface WidthAnalysis {
  readonly headerColumns: number;
  readonly dataRows: number;
  readonly mismatched: readonly CsvRow[];
}

function analyzeWidths(table: CsvTable): WidthAnalysis {
  const header = table.rows[0];
  const headerColumns = header === undefined ? 0 : header.cells.length;
  let dataRows = 0;
  const mismatched: CsvRow[] = [];
  for (const row of table.rows) {
    if (row.index === 0) continue;
    dataRows += 1;
    if (row.cells.length !== headerColumns) mismatched.push(row);
  }
  return { headerColumns, dataRows, mismatched };
}

function widthFindingForSide(
  input: CheckInput,
  path: string,
  ref: "A" | "B",
  present: boolean,
): CheckFinding[] {
  if (!present) return [];
  const side: CheckSide = ref === "A" ? input.base : input.current;
  const table = side.tables.get(path);
  if (table === undefined) return [];
  const analysis = analyzeWidths(table);
  if (analysis.mismatched.length === 0) return [];
  const header = table.rows[0];
  const register: RegisterAnchor = input.registerAnchor;
  const anchors: string[] = [];
  if (header !== undefined) anchors.push(register(ref, path, rowSpan(header), "csv"));
  for (const row of analysis.mismatched.slice(0, MAX_WIDTH_WITNESSES)) {
    anchors.push(register(ref, path, rowSpan(row), "csv"));
  }
  const witnessCount = Math.min(analysis.mismatched.length, MAX_WIDTH_WITNESSES);
  return [
    {
      id: `STRUCT-01|${ref}|${path}`,
      ruleId: "STRUCT-01",
      severity: "major",
      confidence: "exact",
      title: "Row width differs from the header",
      message:
        `${analysis.mismatched.length} of ${analysis.dataRows} data rows in ${path} ` +
        `(side ${ref}) have a width different from the header (${analysis.headerColumns} columns). ` +
        `Loaders that guard on the column count skip such rows.`,
      anchors,
      derivation: [
        `Header cell count on side ${ref}: ${analysis.headerColumns}.`,
        "Every data row width compared against the header — raw CSV structure, nothing inferred.",
        `Witness anchors: header row plus the first ${witnessCount} mismatching row(s).`,
      ],
    },
  ];
}

/**
 * STRUCT-01 — row width differs from the header cell count, per table per side.
 */
export function checkTableWidths(input: CheckInput): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const delta of input.delta.tables) {
    findings.push(...widthFindingForSide(input, delta.path, "A", delta.status !== "added"));
    findings.push(...widthFindingForSide(input, delta.path, "B", delta.status !== "removed"));
  }
  return findings;
}

// ---------------------------------------------------------------------------------------------
// STRUCT-02 — row keys duplicated or empty
// ---------------------------------------------------------------------------------------------

function rowKeyFindingForSide(
  input: CheckInput,
  path: string,
  ref: "A" | "B",
  present: boolean,
): CheckFinding[] {
  if (!present) return [];
  const side: CheckSide = ref === "A" ? input.base : input.current;
  const table = side.tables.get(path);
  if (table === undefined) return [];
  const resolution = resolveRowKey(table, path, input.profile);
  if (resolution === undefined) return [];
  const header = table.rows[0];

  if (resolution.kind === "pin-missing") {
    const anchors: string[] = [];
    if (header !== undefined) anchors.push(input.registerAnchor(ref, path, rowSpan(header), "csv"));
    const wanted = resolution.columns.map((name) => `"${name}"`).join(", ");
    return [
      {
        id: `STRUCT-02|${ref}|${path}|pin`,
        ruleId: "STRUCT-02",
        severity: "major",
        confidence: "exact",
        title: "Pinned row-key column is not in the header",
        message:
          `The project profile pins the row key of ${path} to column(s) ${wanted}, ` +
          `but the header on side ${ref} has no such column. The pinned convention cannot apply.`,
        anchors,
        derivation: [
          `Profile override (pin-row-key) for ${path}: key column(s) ${wanted}.`,
          `Header cells on side ${ref}: ${(header?.cells ?? []).map((cell) => cell.text.trim()).join(", ")}.`,
          "Exact text comparison — at least one pinned column was not found.",
        ],
      },
    ];
  }

  const typeRow = detectTypeRow(table);
  const rows = table.rows.filter((row) => row.index !== 0 && row !== typeRow && !isBlankRow(row));
  const empty: CsvRow[] = [];
  const duplicates: { row: CsvRow; key: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const value = rowKeyValue(row, resolution.columns);
    if (rowKeyIsEmpty(value)) {
      empty.push(row);
      continue;
    }
    if (seen.has(value)) duplicates.push({ row, key: rowKeyDisplay(value) });
    else seen.add(value);
  }
  if (empty.length === 0 && duplicates.length === 0) return [];

  const anchors: string[] = [];
  if (header !== undefined) anchors.push(input.registerAnchor(ref, path, rowSpan(header), "csv"));
  const witnessRows = [...duplicates.map((duplicate) => duplicate.row), ...empty].slice(
    0,
    MAX_KEY_WITNESSES,
  );
  for (const row of witnessRows) {
    anchors.push(input.registerAnchor(ref, path, rowSpan(row), "csv"));
  }
  const parts: string[] = [];
  if (duplicates.length > 0) parts.push(`${duplicates.length} duplicate row key(s)`);
  if (empty.length > 0) parts.push(`${empty.length} empty row key(s)`);
  const keyLabel = rowKeyLabels(table, resolution.columns);
  return [
    {
      id: `STRUCT-02|${ref}|${path}`,
      ruleId: "STRUCT-02",
      severity: "major",
      confidence: resolution.exact ? "exact" : "inferred",
      title: "Row keys are duplicated or empty",
      message:
        `${parts.join(" and ")} among ${rows.length} data rows in ${path} ` +
        `(side ${ref}, key column "${keyLabel}"). Last-wins loaders silently overwrite earlier rows.` +
        (resolution.exact
          ? ""
          : " The key column is inferred (first column) — pin the row-key column to make this finding exact."),
      anchors,
      derivation: [
        resolution.note,
        "Every data row's trimmed key text compared — raw table data, nothing inferred.",
        `Witness anchors: header row plus the first ${witnessRows.length} offending row(s).`,
      ],
    },
  ];
}

/**
 * STRUCT-02 — row keys (PK) duplicated or empty, per table per side.
 */
export function checkRowKeys(input: CheckInput): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const delta of input.delta.tables) {
    findings.push(...rowKeyFindingForSide(input, delta.path, "A", delta.status !== "added"));
    findings.push(...rowKeyFindingForSide(input, delta.path, "B", delta.status !== "removed"));
  }
  return findings;
}

// ---------------------------------------------------------------------------------------------
// STRUCT-03 — header hygiene
// ---------------------------------------------------------------------------------------------

function hygieneFindingForSide(
  input: CheckInput,
  path: string,
  ref: "A" | "B",
  present: boolean,
): CheckFinding[] {
  if (!present) return [];
  const side: CheckSide = ref === "A" ? input.base : input.current;
  const table = side.tables.get(path);
  if (table === undefined) return [];
  const header = table.rows[0];
  if (header === undefined) return [];

  const emptyIndexes: number[] = [];
  const duplicateIndexes: number[] = [];
  const whitespaceIndexes: number[] = [];
  const hiddenIndexes: number[] = [];
  const seen = new Set<string>();
  header.cells.forEach((cell, index) => {
    const text = cell.text;
    const trimmed = text.trim();
    if (trimmed === "") {
      emptyIndexes.push(index);
      return;
    }
    if (text !== trimmed) whitespaceIndexes.push(index);
    if (seen.has(trimmed)) duplicateIndexes.push(index);
    else seen.add(trimmed);
    if (hasHiddenChar(text)) hiddenIndexes.push(index);
  });
  if (
    emptyIndexes.length === 0 &&
    duplicateIndexes.length === 0 &&
    whitespaceIndexes.length === 0 &&
    hiddenIndexes.length === 0
  ) {
    return [];
  }

  const anchors: string[] = [input.registerAnchor(ref, path, rowSpan(header), "csv")];
  const witnessIndexes = [
    ...emptyIndexes,
    ...duplicateIndexes,
    ...whitespaceIndexes,
    ...hiddenIndexes,
  ].slice(0, MAX_CELL_WITNESSES);
  for (const index of witnessIndexes) {
    const cell = header.cells[index];
    if (cell !== undefined) anchors.push(input.registerAnchor(ref, path, cellSpan(cell), "csv"));
  }
  const parts: string[] = [];
  if (duplicateIndexes.length > 0) parts.push(`${duplicateIndexes.length} duplicate name(s)`);
  if (emptyIndexes.length > 0) parts.push(`${emptyIndexes.length} empty cell(s)`);
  if (whitespaceIndexes.length > 0)
    parts.push(`${whitespaceIndexes.length} name(s) with surrounding whitespace`);
  if (hiddenIndexes.length > 0)
    parts.push(`${hiddenIndexes.length} name(s) with invisible characters (zero-width or control)`);
  return [
    {
      id: `STRUCT-03|${ref}|${path}`,
      ruleId: "STRUCT-03",
      severity: "info",
      confidence: "exact",
      title: "Header hygiene issues",
      message:
        `Header row of ${path} (side ${ref}) has ${parts.join(", ")}. ` +
        `Loaders that bind columns by header name can mis-bind on these.`,
      anchors,
      derivation: [
        `Header cells on side ${ref}: ${header.cells.length}.`,
        "Each header cell checked for emptiness, trimmed duplicates, surrounding whitespace and invisible characters (zero-width/control) — raw text comparison. Accented letters are not flagged.",
        `Witness anchors: header row plus the first ${witnessIndexes.length} offending cell(s).`,
      ],
    },
  ];
}

/**
 * STRUCT-03 — header hygiene: empty/whitespace/duplicate/invisible-character header names.
 */
export function checkHeaderHygiene(input: CheckInput): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const delta of input.delta.tables) {
    findings.push(...hygieneFindingForSide(input, delta.path, "A", delta.status !== "added"));
    findings.push(...hygieneFindingForSide(input, delta.path, "B", delta.status !== "removed"));
  }
  return findings;
}

// ---------------------------------------------------------------------------------------------
// DRIFT-01 — A/B header drift (rename or reorder at the same column count)
// ---------------------------------------------------------------------------------------------

/**
 * DRIFT-01 — the header row changed between A and B while the column count stayed the same.
 */
export function checkHeaderDrift(input: CheckInput): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const delta of input.delta.tables) {
    if (!delta.headerChanged || delta.status !== "changed") continue;
    const beforeTable = input.base.tables.get(delta.path);
    const afterTable = input.current.tables.get(delta.path);
    if (beforeTable === undefined || afterTable === undefined) continue;
    const beforeHeader = beforeTable.rows[0];
    const afterHeader = afterTable.rows[0];
    if (beforeHeader === undefined || afterHeader === undefined) continue;
    const before = beforeHeader.cells.map((cell) => cell.text.trim());
    const after = afterHeader.cells.map((cell) => cell.text.trim());
    if (before.length !== after.length || before.length < 2) continue;

    const changed: { index: number; before: string; after: string }[] = [];
    for (const [index, name] of before.entries()) {
      const next = after[index];
      if (next !== undefined && next !== name) changed.push({ index, before: name, after: next });
    }
    if (changed.length === 0) continue;

    const sameSet = [...before].sort().join("\u0000") === [...after].sort().join("\u0000");
    const kind = sameSet ? "reordered" : "renamed";
    const pinnedColumns =
      input.profile?.readerProfile.bindings
        .filter((binding) => binding.csvPath === delta.path)
        .flatMap((binding) => binding.columns.map((column) => column.trim())) ?? [];
    const missingPinnedColumns = pinnedColumns.filter((column) => !after.includes(column));
    const bindingResolves = pinnedColumns.length > 0 && missingPinnedColumns.length === 0;

    let severity: CheckFinding["severity"] = "critical";
    let effectConfidence: NonNullable<CheckFinding["effectConfidence"]> = "inferred";
    let readerNote = "";
    if (missingPinnedColumns.length > 0) {
      effectConfidence = "exact";
      readerNote =
        ` The pinned name binding includes ${missingPinnedColumns.map((column) => `"${column}"`).join(", ")}, ` +
        "which is missing on side B — that lookup fails (also reported by BIND-01).";
    } else if (bindingResolves && kind === "reordered") {
      severity = "info";
      effectConfidence = "exact";
      readerNote =
        ` A pinned name binding reads ${pinnedColumns.map((column) => `"${column}"`).join(", ")} by name, ` +
        "so column order is irrelevant for that reader.";
    } else if (bindingResolves) {
      severity = "major";
      readerNote =
        ` A pinned name binding reads ${pinnedColumns.map((column) => `"${column}"`).join(", ")} by name ` +
        "and all of them still exist; renamed columns outside that set may affect readers that use names.";
    }

    const anchors: string[] = [
      input.registerAnchor("A", delta.path, rowSpan(beforeHeader), "csv"),
      input.registerAnchor("B", delta.path, rowSpan(afterHeader), "csv"),
    ];
    for (const change of changed.slice(0, MAX_DRIFT_WITNESSES)) {
      const oldCell = beforeHeader.cells[change.index];
      const newCell = afterHeader.cells[change.index];
      if (oldCell !== undefined) {
        anchors.push(input.registerAnchor("A", delta.path, cellSpan(oldCell), "csv"));
      }
      if (newCell !== undefined) {
        anchors.push(input.registerAnchor("B", delta.path, cellSpan(newCell), "csv"));
      }
    }
    const witnesses = changed
      .slice(0, 4)
      .map((change) => `#${change.index} "${change.before}" → "${change.after}"`)
      .join(", ");
    const consequence =
      bindingResolves && kind === "reordered"
        ? "Readers not covered by that pin may still address columns by position; their behavior is unknown."
        : bindingResolves
          ? "Some readers may address columns by position or use other names; their behavior is unknown."
          : "Readers that address columns by position may read a different field; name-based readers " +
            "may miss renamed columns. Whether this project reads by position or name is not pinned, " +
            "so the runtime effect is inferred. Nothing throws - the value can be silently wrong.";
    findings.push({
      id: `DRIFT-01|B|${delta.path}`,
      ruleId: "DRIFT-01",
      severity,
      confidence: "exact",
      effectConfidence,
      title: "A/B column drift",
      message:
        `Header row of ${delta.path} was ${kind} between A and B at the same column count ` +
        `(${before.length} columns): ${witnesses}${changed.length > 4 ? `, +${changed.length - 4} more` : ""}. ` +
        `${consequence}${readerNote}`,
      anchors,
      derivation: [
        `Column count is equal on both sides: ${before.length}.`,
        `Header names compared by trimmed text at each 0-based position; ${changed.length} position(s) differ.`,
        `Name set is ${sameSet ? "identical → reorder" : "different → rename"}.`,
        pinnedColumns.length === 0
          ? "No name binding is pinned for this table; whether any reader is positional is not known from CSV alone."
          : `Pinned name binding: ${pinnedColumns.map((column) => `"${column}"`).join(", ")}; ${missingPinnedColumns.length === 0 ? "all still present on side B." : `missing on side B: ${missingPinnedColumns.map((column) => `"${column}"`).join(", ")}.`}`,
      ],
    });
  }
  return findings;
}

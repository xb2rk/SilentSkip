import {
  cellSpan,
  columnLabel,
  detectTypeRow,
  failsDeclaredType,
  isBlankRow,
  rowSpan,
} from "../csv/analysis.js";
import type { CsvCell, CsvRow } from "../csv/index.js";
import type { CheckFinding, CheckInput, CheckSide } from "./types.js";

/** Maximum cell witnesses attached to one TYPE-01 finding. */
const MAX_CELL_WITNESSES = 8;

const LEADING_ZERO_PATTERN = /^-?0\d+/u;

interface TypeWitness {
  readonly row: CsvRow;
  readonly cell: CsvCell;
  readonly declared: string;
  readonly value: string;
}

function typeFindingForSide(
  input: CheckInput,
  path: string,
  ref: "A" | "B",
  present: boolean,
): CheckFinding[] {
  if (!present) return [];
  const side: CheckSide = ref === "A" ? input.base : input.current;
  const table = side.tables.get(path);
  if (table === undefined) return [];
  const typeRow = detectTypeRow(table);
  if (typeRow === undefined) return [];
  const declared = typeRow.cells.map((cell) => cell.text.trim().toLowerCase());

  const mismatches: TypeWitness[] = [];
  const leadingZeros: TypeWitness[] = [];
  for (const row of table.rows) {
    if (row.index <= typeRow.index || isBlankRow(row)) continue;
    for (let index = 0; index < declared.length; index++) {
      const cell = row.cells[index];
      const type = declared[index];
      if (cell === undefined || type === undefined) continue;
      const value = cell.text.trim();
      if (value === "") continue;
      if (failsDeclaredType(type, value)) {
        mismatches.push({ row, cell, declared: type, value });
      } else if ((type === "int" || type === "int64") && LEADING_ZERO_PATTERN.test(value)) {
        leadingZeros.push({ row, cell, declared: type, value });
      }
    }
  }
  if (mismatches.length === 0 && leadingZeros.length === 0) return [];

  const typeRowAnchor = input.registerAnchor(ref, path, rowSpan(typeRow), "csv");
  const findings: CheckFinding[] = [];
  if (mismatches.length > 0) {
    const anchors = [typeRowAnchor];
    for (const witness of mismatches.slice(0, MAX_CELL_WITNESSES)) {
      anchors.push(input.registerAnchor(ref, path, cellSpan(witness.cell), "csv"));
    }
    const sample = mismatches
      .slice(0, 3)
      .map(
        (witness) =>
          `"${witness.value}" (row ${witness.row.line}, column "${columnLabel(table, witness.cell.column)}", declared ${witness.declared})`,
      );
    findings.push({
      id: `TYPE-01|${ref}|${path}`,
      ruleId: "TYPE-01",
      severity: "minor",
      confidence: "exact",
      title: "Values do not match the declared type row",
      message:
        `${mismatches.length} cell(s) in ${path} (side ${ref}) do not match their declared type — ` +
        `e.g. ${sample.join("; ")}. Loaders that parse by the type row fall back to defaults on these.`,
      anchors,
      derivation: [
        `Type row on side ${ref}: ${declared.map((type) => (type === "" ? "-" : type)).join(", ")}.`,
        "Every data cell compared against its declared type with exact text/number checks.",
        `Witness anchors: type row plus the first ${Math.min(mismatches.length, MAX_CELL_WITNESSES)} offending cell(s).`,
      ],
    });
  }
  if (leadingZeros.length > 0) {
    const anchors = [typeRowAnchor];
    for (const witness of leadingZeros.slice(0, MAX_CELL_WITNESSES)) {
      anchors.push(input.registerAnchor(ref, path, cellSpan(witness.cell), "csv"));
    }
    findings.push({
      id: `TYPE-01|${ref}|${path}|leading-zero`,
      ruleId: "TYPE-01",
      severity: "info",
      confidence: "exact",
      title: "Integer values carry leading zeros",
      message:
        `${leadingZeros.length} integer cell(s) in ${path} (side ${ref}) keep leading zeros ` +
        `(e.g. "${leadingZeros[0]?.value ?? ""}"). Parsers that read them as numbers lose the formatting; ` +
        `parsers that read raw text keep it.`,
      anchors,
      derivation: [
        "Declared type is int/int64 for these cells.",
        "Values match ^0\\d+ — the zero prefix is format, not value.",
        `Witness anchors: type row plus the first ${Math.min(leadingZeros.length, MAX_CELL_WITNESSES)} offending cell(s).`,
      ],
    });
  }
  return findings;
}

/**
 * TYPE-01 — declared type row vs real values: a value that would fail the declared type
 * (parse-fail defaulting, `minor`) and leading-zero integers (lossy format, `info`).
 */
export function checkTypeRows(input: CheckInput): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const delta of input.delta.tables) {
    findings.push(...typeFindingForSide(input, delta.path, "A", delta.status !== "added"));
    findings.push(...typeFindingForSide(input, delta.path, "B", delta.status !== "removed"));
  }
  return findings;
}

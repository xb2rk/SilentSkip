/**
 * Built-in checks (E7.1 baseline): pure functions over `CheckInput`.
 *
 * Shipped rules:
 * - `STRUCT-01` — row width differs from the header cell count, per table per side. The loader
 *   guard is a comparison against a column-count constant; this check reports the raw structure
 *   the guard would skip rows on. Nothing is inferred about what the "right" width is.
 * - `DANGLING-REF` — a symbol removed in B still has same-name references in B that resolve
 *   nowhere, while the A-side references resolved exactly to the removed symbol.
 */

import type { CsvRow, CsvTable } from "../csv/index.js";
import type { FactSpan } from "../facts/index.js";
import type { CheckFinding, CheckInput, CheckSide, RegisterAnchor } from "./types.js";

/** Maximum mismatching-row witnesses attached to one STRUCT-01 finding. */
const MAX_WIDTH_WITNESSES = 10;

/** Maximum reference witnesses per side attached to one DANGLING-REF finding. */
const MAX_REF_WITNESSES = 5;

/** Runs every shipped check and returns findings sorted by id. */
export function runChecks(input: CheckInput): CheckFinding[] {
  const findings = [...checkTableWidths(input), ...checkDanglingReferences(input)];
  return findings.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Row-width analysis of one table side. */
interface WidthAnalysis {
  readonly headerColumns: number;
  readonly dataRows: number;
  readonly mismatched: readonly CsvRow[];
}

function rowSpan(row: CsvRow): FactSpan {
  return { offset: row.offset, length: row.length, line: row.line, endLine: row.endLine };
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

function checkTableWidths(input: CheckInput): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const delta of input.delta.tables) {
    findings.push(...widthFindingForSide(input, delta.path, "A", delta.status !== "added"));
    findings.push(...widthFindingForSide(input, delta.path, "B", delta.status !== "removed"));
  }
  return findings;
}

function checkDanglingReferences(input: CheckInput): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const script of input.delta.scripts) {
    if (script.symbolsRemoved.length === 0) continue;
    const before = input.base.factsByPath.get(script.path);
    if (before === undefined) continue;
    const after = input.current.factsByPath.get(script.path);
    for (const symbol of script.symbolsRemoved) {
      // Local bindings vanish with their function; only named declarations can dangle.
      if (symbol.scope === "local") continue;
      const baseRefs = before.refs.filter(
        (ref) => ref.resolution.status === "resolved" && ref.resolution.resolvedId === symbol.id,
      );
      if (baseRefs.length === 0) continue;
      const currentRefs =
        after === undefined ? [] : after.refs.filter((ref) => ref.name === symbol.name);
      if (currentRefs.length === 0) continue;
      const anyLive = currentRefs.some(
        (ref) => ref.resolution.status === "resolved" || ref.resolution.status === "ambiguous",
      );
      if (anyLive) continue;
      const anchors: string[] = [input.registerAnchor("A", script.path, symbol.nameSpan, "code")];
      for (const ref of baseRefs.slice(0, MAX_REF_WITNESSES)) {
        anchors.push(input.registerAnchor("A", script.path, ref.span, "code"));
      }
      for (const ref of currentRefs.slice(0, MAX_REF_WITNESSES)) {
        anchors.push(input.registerAnchor("B", script.path, ref.span, "code"));
      }
      findings.push({
        id: `DANGLING-REF|${symbol.id}`,
        ruleId: "DANGLING-REF",
        severity: "major",
        confidence: "exact",
        title: "Removed symbol still has unresolved references",
        message:
          `Symbol ${symbol.name} (${symbol.kind}) was removed in B, but ` +
          `${currentRefs.length} reference(s) with the same name in ${script.path} remain ` +
          `unresolved — no replacement symbol resolves them.`,
        anchors,
        derivation: [
          `Delta matched the symbol as removed: ${symbol.id}.`,
          `${baseRefs.length} reference(s) on side A resolved exactly to it.`,
          `All ${currentRefs.length} same-name reference(s) on side B are unresolved — checked, not guessed.`,
        ],
      });
    }
  }
  return findings;
}

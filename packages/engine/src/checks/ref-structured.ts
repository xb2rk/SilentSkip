/**
 * REF-02 — structured cells (e.g. `"10000:2"`) whose pinned part references another table.
 *
 * Only the pinned part is checked; the rest of the cell is never interpreted. A part that is
 * absent or empty is reported as malformed, not guessed. Intent comes from
 * `readerProfile.structuredCells`; the target row key must be pinned for a conclusion.
 */

import {
  type CsvRow,
  cellSpan,
  columnLabel,
  dataRows,
  normalizeCastValue,
  resolveRowKey,
  rowKeyIsEmpty,
  rowKeyValue,
  rowSpan,
} from "../csv/index.js";
import { refInfoFinding } from "./ref-common.js";
import type { CheckFinding, CheckInput } from "./types.js";

/** Maximum broken-value witnesses attached to one REF-02 finding. */
const MAX_REF_WITNESSES = 8;

export function checkStructuredReferences(input: CheckInput): CheckFinding[] {
  const cells = input.profile?.readerProfile.structuredCells ?? [];
  if (cells.length === 0) return [];

  const findings: CheckFinding[] = [];
  for (const entry of cells) {
    const sourceTable = input.current.tables.get(entry.csvPath);
    const sourceHeader = sourceTable?.rows[0];
    if (sourceTable === undefined || sourceHeader === undefined) {
      findings.push(
        refInfoFinding(
          "REF-02",
          `REF-02|B|${entry.csvPath}|${entry.column}|${entry.targetPath}|table-missing`,
          "Pinned structured-cell table is not in the current tree",
          `The profile pins structured cell ${entry.csvPath}."${entry.column}", but no such CSV table exists on side B. Nothing was compared.`,
          [],
          [
            "The declaration comes from readerProfile.structuredCells; no file with that path exists on side B.",
          ],
        ),
      );
      continue;
    }

    const column = sourceHeader.cells.findIndex((cell) => cell.text.trim() === entry.column);
    const sourceAnchor = input.registerAnchor("B", entry.csvPath, rowSpan(sourceHeader), "csv");
    const idBase = `REF-02|B|${entry.csvPath}|${entry.column}|${entry.targetPath}`;
    if (column < 0) {
      findings.push(
        refInfoFinding(
          "REF-02",
          `${idBase}|column-missing`,
          "Pinned structured-cell column is not in the header",
          `The profile pins structured cell ${entry.csvPath}."${entry.column}", but that header has no such column on side B.`,
          [sourceAnchor],
          [
            `Header cells on side B: ${sourceHeader.cells.map((cell) => cell.text.trim()).join(", ")}.`,
          ],
        ),
      );
      continue;
    }

    const targetTable = input.current.tables.get(entry.targetPath);
    const targetHeader = targetTable?.rows[0];
    if (targetTable === undefined || targetHeader === undefined) {
      findings.push(
        refInfoFinding(
          "REF-02",
          `${idBase}|target-missing`,
          "Pinned structured-cell target table is not in the current tree",
          `The structured cell points at ${entry.targetPath}, which is not a CSV table on side B. Nothing was compared.`,
          [sourceAnchor],
          [
            "The target path comes from the reader profile; no file with that path exists on side B.",
          ],
        ),
      );
      continue;
    }

    const targetKey = resolveRowKey(targetTable, entry.targetPath, input.profile);
    if (targetKey === undefined) continue;
    if (targetKey.kind === "pin-missing") {
      findings.push(
        refInfoFinding(
          "REF-02",
          `${idBase}|target-key-missing`,
          "REF-02 target key pin cannot be applied",
          `The row key of ${entry.targetPath} is pinned to ${targetKey.columns.map((name) => `"${name}"`).join(", ")}, but that header does not contain it.`,
          [sourceAnchor],
          ["The target key pin (pin-row-key) and the target header disagree."],
        ),
      );
      continue;
    }
    if (!targetKey.exact) {
      findings.push(
        refInfoFinding(
          "REF-02",
          `${idBase}|target-key-inferred`,
          "REF-02 not verified: target row key is only inferred",
          `REF-02 needs the referenced key of ${entry.targetPath} pinned; the first column is only an inferred convention, so broken parts are not concluded.`,
          [sourceAnchor],
          [
            targetKey.note,
            "Pin the row key of the target table to enable exact structured-cell verification.",
          ],
        ),
      );
      continue;
    }
    if (targetKey.columns.length > 1) {
      findings.push(
        refInfoFinding(
          "REF-02",
          `${idBase}|target-key-composite`,
          "REF-02 not verified: composite target keys are out of scope",
          `The row key of ${entry.targetPath} is composite, while a structured-cell part is a single value. No component matching is guessed.`,
          [sourceAnchor],
          [
            `Target key columns: ${targetKey.columns.map((index) => `"${columnLabel(targetTable, index)}"`).join(", ")}.`,
          ],
        ),
      );
      continue;
    }

    const separator = entry.split === "colon" ? ":" : "|";
    const entrySeparator =
      entry.entrySeparator === "semicolon" ? ";" : entry.entrySeparator === "pipe" ? "|" : null;
    const entryIndex = entrySeparator === null ? undefined : entry.entryIndex;
    const targetKeys = new Set<string>();
    for (const row of dataRows(targetTable)) {
      const raw = rowKeyValue(row, targetKey.columns);
      if (rowKeyIsEmpty(raw)) continue;
      const normalized = normalizeCastValue(raw, entry.cast);
      if (normalized !== undefined) targetKeys.add(normalized);
    }

    let malformed = 0;
    const broken: { row: CsvRow; value: string }[] = [];
    let scanned = 0;
    for (const row of dataRows(sourceTable)) {
      const raw = row.cells[column]?.text.trim() ?? "";
      if (raw === "") continue;
      scanned += 1;
      const entries =
        entrySeparator === null
          ? [raw]
          : raw
              .split(entrySeparator)
              .map((part) => part.trim())
              .filter((part) => part !== "");
      const selected =
        entryIndex === undefined ? entries : entries.slice(entryIndex, entryIndex + 1);
      if (selected.length === 0) {
        malformed += 1;
        broken.push({ row, value: raw });
        continue;
      }
      let rowMalformed = false;
      let rowBroken = false;
      let brokenValue: string | null = null;
      for (const segment of selected) {
        const parts = segment.split(separator).map((part) => part.trim());
        const partValue = parts[entry.part];
        if (partValue === undefined || partValue === "") {
          rowMalformed = true;
          brokenValue ??= raw;
          continue;
        }
        const normalized = normalizeCastValue(partValue, entry.cast);
        if (normalized === undefined || !targetKeys.has(normalized)) {
          rowBroken = true;
          brokenValue ??= segment;
        }
      }
      if (rowMalformed) malformed += 1;
      if (rowMalformed || rowBroken) broken.push({ row, value: brokenValue ?? raw });
    }
    if (broken.length === 0) continue;

    const witnesses = broken.slice(0, MAX_REF_WITNESSES);
    const anchors = [sourceAnchor];
    for (const witness of witnesses) {
      const cell = witness.row.cells[column];
      if (cell !== undefined) {
        anchors.push(input.registerAnchor("B", entry.csvPath, cellSpan(cell), "csv"));
      }
    }
    anchors.push(input.registerAnchor("B", entry.targetPath, rowSpan(targetHeader), "csv"));
    const shown = witnesses
      .map((witness) => `"${witness.value}" (line ${witness.row.line})`)
      .join(", ");
    const unmatched = broken.length - malformed;
    const entryLabel =
      entrySeparator === null
        ? "cell"
        : entryIndex === undefined
          ? `entry (split "${entrySeparator}")`
          : `entry ${String(entryIndex)} (split "${entrySeparator}")`;

    findings.push({
      id: idBase,
      ruleId: "REF-02",
      severity: "major",
      confidence: "exact",
      effectConfidence: "inferred",
      title: "Structured cell part has no target row",
      message:
        `${String(broken.length)} cell(s) in ${entry.csvPath} column "${entry.column}" have a ` +
        `${entryLabel} whose part ${String(entry.part)} does not resolve against ${entry.targetPath} ` +
        `(part split "${separator}", cast ${entry.cast}); ${String(malformed)} malformed, ` +
        `${String(unmatched)} missing target: ${shown}` +
        `${broken.length > witnesses.length ? `, +${String(broken.length - witnesses.length)} more` : ""}. ` +
        "A load-time lookup falls back or ignores that part; the rest of the cell is not interpreted.",
      anchors,
      derivation: [
        `The structured cell is pinned (readerProfile.structuredCells): ${entry.csvPath}."${entry.column}" → ${entry.targetPath}.`,
        entrySeparator === null
          ? `Part ${String(entry.part)} selected after splitting on "${separator}" (zero-based).`
          : entryIndex === undefined
            ? `The cell is split into entries on "${entrySeparator}"; every entry is split on "${separator}" and part ${String(entry.part)} is checked.`
            : `The cell is split into entries on "${entrySeparator}"; entry ${String(entryIndex)} is split on "${separator}" and part ${String(entry.part)} is checked.`,
        `The target row key is pinned (pin-row-key): ${targetKey.columns.map((index) => `"${columnLabel(targetTable, index)}"`).join(", ")} (exact).`,
        `Matching uses cast ${entry.cast}: ${entry.cast === "int" ? "numeric, so leading zeros compare equal" : "exact string equality"}.`,
        `Compared ${String(scanned)} non-empty cell(s) with ${String(targetKeys.size)} target key(s); ${String(malformed)} cell(s) had a missing part.`,
      ],
    });
  }
  return findings;
}

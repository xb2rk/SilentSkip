/**
 * REF-01 — single-value foreign keys against a pinned relationship.
 *
 * Intent is pinned (`pin-fk`); an `int` cast compares numerically (`00100` ≡ `100`), a `string`
 * cast compares exactly, and an unknown cast is never concluded on. The referenced table's key
 * must itself be pinned (`pin-row-key`); without that pin the first column is only an inferred
 * convention, which is not strong enough to call a FK broken.
 */

import {
  type CsvRow,
  cellSpan,
  columnLabel,
  dataRows,
  fkPins,
  normalizeCastValue,
  resolveRowKey,
  rowKeyIsEmpty,
  rowKeyValue,
  rowSpan,
} from "../csv/index.js";
import { refInfoFinding } from "./ref-common.js";
import type { CheckFinding, CheckInput } from "./types.js";

/** Maximum broken-value witnesses attached to one REF-01 finding. */
const MAX_REF_WITNESSES = 8;

export function checkForeignKeys(input: CheckInput): CheckFinding[] {
  const pins = fkPins(input.profile);
  if (pins.length === 0) return [];

  const findings: CheckFinding[] = [];
  for (const pin of pins) {
    const sourceTable = input.current.tables.get(pin.sourcePath);
    if (sourceTable === undefined) continue;
    const sourceHeader = sourceTable.rows[0];
    if (sourceHeader === undefined) continue;
    const column = sourceHeader.cells.findIndex((cell) => cell.text.trim() === pin.sourceColumn);
    const sourceAnchor = input.registerAnchor("B", pin.sourcePath, rowSpan(sourceHeader), "csv");
    const idBase = `REF-01|B|${pin.sourcePath}|${pin.sourceColumn}|${pin.targetPath}`;

    if (column < 0) {
      findings.push(
        refInfoFinding(
          "REF-01",
          `${idBase}|column-missing`,
          "Pinned FK column is not in the header",
          `The profile pins a foreign key from ${pin.sourcePath} column "${pin.sourceColumn}", but that header has no such column on side B.`,
          [sourceAnchor],
          [
            `Profile override (pin-fk) names column "${pin.sourceColumn}".`,
            `Header cells on side B: ${sourceHeader.cells.map((cell) => cell.text.trim()).join(", ")}.`,
            "Exact text comparison — the column was not found.",
          ],
        ),
      );
      continue;
    }

    const targetTable = input.current.tables.get(pin.targetPath);
    const targetHeader = targetTable?.rows[0];
    if (targetTable === undefined || targetHeader === undefined) {
      findings.push(
        refInfoFinding(
          "REF-01",
          `${idBase}|target-missing`,
          "Pinned FK target table is not in the current tree",
          `The FK pin points at ${pin.targetPath}, which is not a CSV table on side B. Nothing was compared.`,
          [sourceAnchor],
          ["The target path comes from the pin; no file with that path exists on side B."],
        ),
      );
      continue;
    }

    if (pin.cast === "unknown") {
      findings.push(
        refInfoFinding(
          "REF-01",
          `${idBase}|cast-unknown`,
          "FK cast is unknown — not concluded",
          `The pin for ${pin.sourcePath}."${pin.sourceColumn}" does not declare a supported cast (int|string). Per the matching rules the raw values stay unverified.`,
          [sourceAnchor],
          [
            "Matching is decided by the runtime cast of the binding (spec §4.10).",
            "No cast means no normalization and no conclusion.",
          ],
        ),
      );
      continue;
    }

    const targetKey = resolveRowKey(targetTable, pin.targetPath, input.profile);
    if (targetKey === undefined) {
      continue;
    }
    if (targetKey.kind === "pin-missing") {
      findings.push(
        refInfoFinding(
          "REF-01",
          `${idBase}|target-key-missing`,
          "FK target key pin cannot be applied",
          `The row key of ${pin.targetPath} is pinned to ${targetKey.columns.map((name) => `"${name}"`).join(", ")}, but that header does not contain it.`,
          [sourceAnchor],
          ["The target key pin (pin-row-key) and the target header disagree."],
        ),
      );
      continue;
    }
    if (!targetKey.exact) {
      findings.push(
        refInfoFinding(
          "REF-01",
          `${idBase}|target-key-inferred`,
          "FK not verified: target row key is only inferred",
          `REF-01 needs the referenced key of ${pin.targetPath} pinned; the first column is only an inferred convention, so broken values are not concluded.`,
          [sourceAnchor],
          [targetKey.note, "Pin the row key of the target table to enable exact FK verification."],
        ),
      );
      continue;
    }

    if (targetKey.columns.length > 1) {
      findings.push(
        refInfoFinding(
          "REF-01",
          `${idBase}|target-key-composite`,
          "FK not verified: composite target keys need REF-02",
          `The row key of ${pin.targetPath} is composite, while this pin declares a single-value foreign key. Component matching is REF-02 scope and is not guessed here.`,
          [sourceAnchor],
          [
            `Target key columns: ${targetKey.columns.map((index) => `"${columnLabel(targetTable, index)}"`).join(", ")}.`,
            "REF-02 structured-cell matching is a later milestone.",
          ],
        ),
      );
      continue;
    }

    const targetKeys = new Set<string>();
    for (const row of dataRows(targetTable)) {
      const raw = rowKeyValue(row, targetKey.columns);
      if (rowKeyIsEmpty(raw)) continue;
      if (targetKey.columns.length === 1) {
        const normalized = normalizeCastValue(raw, pin.cast);
        if (normalized !== undefined) targetKeys.add(normalized);
        continue;
      }
      const parts = raw.split("\u001f");
      const normalizedParts = parts.map((part) => normalizeCastValue(part, pin.cast));
      if (normalizedParts.every((part) => part !== undefined)) {
        targetKeys.add(normalizedParts.join("\u001f"));
      }
    }

    const broken: { row: CsvRow; value: string }[] = [];
    for (const row of dataRows(sourceTable)) {
      const cell = row.cells[column];
      const raw = cell?.text.trim() ?? "";
      if (raw === "") continue;
      const normalized = normalizeCastValue(raw, pin.cast);
      if (normalized === undefined || !targetKeys.has(normalized)) {
        broken.push({ row, value: raw });
      }
    }
    if (broken.length === 0) continue;

    const witnesses = broken.slice(0, MAX_REF_WITNESSES);
    const anchors = [sourceAnchor];
    for (const witness of witnesses) {
      const cell = witness.row.cells[column];
      if (cell !== undefined) {
        anchors.push(input.registerAnchor("B", pin.sourcePath, cellSpan(cell), "csv"));
      }
    }
    anchors.push(input.registerAnchor("B", pin.targetPath, rowSpan(targetHeader), "csv"));
    const shown = witnesses
      .map((witness) => `"${witness.value}" (line ${witness.row.line})`)
      .join(", ");

    findings.push({
      id: idBase,
      ruleId: "REF-01",
      severity: "major",
      confidence: "exact",
      effectConfidence: "inferred",
      title: "Foreign key value has no target row",
      message:
        `${broken.length} cell(s) in ${pin.sourcePath} column "${pin.sourceColumn}" do not match any ` +
        `key of ${pin.targetPath} under cast ${pin.cast}: ${shown}` +
        `${broken.length > witnesses.length ? `, +${broken.length - witnesses.length} more` : ""}. ` +
        `A load-time lookup falls back or disables the consumer — the target row simply does not exist.`,
      anchors,
      derivation: [
        `The relationship is pinned (pin-fk): ${pin.sourcePath}."${pin.sourceColumn}" → ${pin.targetPath}.`,
        `The target row key is pinned (pin-row-key): ${targetKey.columns.map((index) => `"${columnLabel(targetTable, index)}"`).join(", ")} (exact).`,
        `Matching uses cast ${pin.cast} (spec §4.10): ${pin.cast === "int" ? "numeric, so leading zeros compare equal" : "exact string equality"}.`,
        `Compared ${dataRows(sourceTable).length} source row(s) with ${targetKeys.size} target key(s); ${broken.length} had no match.`,
      ],
    });
  }
  return findings;
}

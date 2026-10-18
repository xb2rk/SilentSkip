/**
 * REF-01 — single-value foreign keys against a pinned relationship.
 *
 * The engine cannot know that a CSV column points at another table, so intent is pinned:
 * `pin-fk` with `target.csvPath` = referencing table, `target.rowKey` = referencing column and
 * `value` = `<targetCsvPath>#<int|string|unknown>`. Matching follows spec §4.10: the runtime
 * cast decides (`int` compares numerically, so `00100` ≡ `100`; `string` compares exactly). An
 * unknown cast is never concluded on — the check reports that it cannot verify.
 *
 * The referenced table's key must itself be pinned (`pin-row-key`); without that pin the first
 * column is only an inferred convention, which is not strong enough to call a FK broken.
 * REF-02 (structured cells) is a later milestone; its pins are not guessed here.
 */

import type { ProjectProfile } from "@craftland-qa/contracts";
import type { CsvRow, CsvTable } from "../csv/index.js";
import {
  cellSpan,
  detectTypeRow,
  isBlankRow,
  resolveRowKey,
  rowKeyIsEmpty,
  rowKeyValue,
  rowSpan,
} from "../csv/index.js";
import type { CheckFinding, CheckInput } from "./types.js";

/** Maximum broken-value witnesses attached to one REF-01 finding. */
const MAX_REF_WITNESSES = 8;

type Cast = "int" | "string" | "unknown";

interface FkPin {
  readonly sourcePath: string;
  readonly sourceColumn: string;
  readonly targetPath: string;
  readonly cast: Cast;
}

function parseCast(token: string | undefined): Cast {
  if (token === "int" || token === "string") return token;
  return "unknown";
}

/** Parses `<targetPath>#<cast>`; the path may contain `#`, so split on the last one. */
function parseFkValue(value: string | undefined): { targetPath: string; cast: Cast } | undefined {
  if (value === undefined) return undefined;
  const split = value.lastIndexOf("#");
  if (split <= 0 || split === value.length - 1) return undefined;
  return {
    targetPath: value.slice(0, split).trim(),
    cast: parseCast(value.slice(split + 1).trim()),
  };
}

function fkPins(profile: ProjectProfile | undefined): FkPin[] {
  const pins: FkPin[] = [];
  for (const override of profile?.overrides ?? []) {
    if (override.kind !== "pin-fk") continue;
    const sourcePath = override.target.csvPath;
    const sourceColumn = override.target.rowKey;
    const parsed = parseFkValue(override.value);
    if (sourcePath === undefined || sourceColumn === undefined || parsed === undefined) continue;
    pins.push({ sourcePath, sourceColumn, targetPath: parsed.targetPath, cast: parsed.cast });
  }
  return pins;
}

function dataRows(table: CsvTable): CsvRow[] {
  const typeRow = detectTypeRow(table);
  return table.rows.filter((row) => row.index !== 0 && row !== typeRow && !isBlankRow(row));
}

/** Normalizes one value under the declared cast; `undefined` means it cannot match. */
function normalize(value: string, cast: Cast): string | undefined {
  if (cast === "string") return value;
  if (cast !== "int") return undefined;
  const trimmed = value.trim();
  if (!/^-?\d+$/u.test(trimmed)) return undefined;
  try {
    return BigInt(trimmed).toString();
  } catch {
    return undefined;
  }
}

function infoFinding(
  id: string,
  title: string,
  message: string,
  anchors: string[],
  derivation: string[],
): CheckFinding {
  return {
    id,
    ruleId: "REF-01",
    severity: "info",
    confidence: "exact",
    effectConfidence: "inferred",
    title,
    message,
    anchors,
    derivation,
  };
}

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
        infoFinding(
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
        infoFinding(
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
        infoFinding(
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
        infoFinding(
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
        infoFinding(
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
        infoFinding(
          `${idBase}|target-key-composite`,
          "FK not verified: composite target keys need REF-02",
          `The row key of ${pin.targetPath} is composite, while this pin declares a single-value foreign key. Component matching is REF-02 scope and is not guessed here.`,
          [sourceAnchor],
          [
            `Target key columns: ${targetKey.columns.map((index) => `"${columnLabelOf(targetTable, index)}"`).join(", ")}.`,
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
        const normalized = normalize(raw, pin.cast);
        if (normalized !== undefined) targetKeys.add(normalized);
        continue;
      }
      const parts = raw.split("\u001f");
      const normalizedParts = parts.map((part) => normalize(part, pin.cast));
      if (normalizedParts.every((part) => part !== undefined)) {
        targetKeys.add(normalizedParts.join("\u001f"));
      }
    }

    const broken: { row: CsvRow; value: string }[] = [];
    for (const row of dataRows(sourceTable)) {
      const cell = row.cells[column];
      const raw = cell?.text.trim() ?? "";
      if (raw === "") continue;
      const normalized = normalize(raw, pin.cast);
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
        `The target row key is pinned (pin-row-key): ${targetKey.columns.map((index) => `"${columnLabelOf(targetTable, index)}"`).join(", ")} (exact).`,
        `Matching uses cast ${pin.cast} (spec §4.10): ${pin.cast === "int" ? "numeric, so leading zeros compare equal" : "exact string equality"}.`,
        `Compared ${dataRows(sourceTable).length} source row(s) with ${targetKeys.size} target key(s); ${broken.length} had no match.`,
      ],
    });
  }
  return findings;
}

/**
 * REF-02: structured cells (e.g. `"10000:2"`) whose pinned part references another table.
 *
 * Only the pinned part is checked; the rest of the cell is never interpreted. A part that
 * is absent or empty is reported as malformed, not guessed.
 */
export function checkStructuredReferences(input: CheckInput): CheckFinding[] {
  const cells = input.profile?.readerProfile.structuredCells ?? [];
  if (cells.length === 0) return [];

  const findings: CheckFinding[] = [];
  for (const entry of cells) {
    const sourceTable = input.current.tables.get(entry.csvPath);
    const sourceHeader = sourceTable?.rows[0];
    if (sourceTable === undefined || sourceHeader === undefined) {
      findings.push(
        infoFinding(
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
        infoFinding(
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
        infoFinding(
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
        infoFinding(
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
        infoFinding(
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
        infoFinding(
          `${idBase}|target-key-composite`,
          "REF-02 not verified: composite target keys are out of scope",
          `The row key of ${entry.targetPath} is composite, while a structured-cell part is a single value. No component matching is guessed.`,
          [sourceAnchor],
          [
            `Target key columns: ${targetKey.columns.map((index) => `"${columnLabelOf(targetTable, index)}"`).join(", ")}.`,
          ],
        ),
      );
      continue;
    }

    const separator = entry.split === "colon" ? ":" : "|";
    const targetKeys = new Set<string>();
    for (const row of dataRows(targetTable)) {
      const raw = rowKeyValue(row, targetKey.columns);
      if (rowKeyIsEmpty(raw)) continue;
      const normalized = normalize(raw, entry.cast);
      if (normalized !== undefined) targetKeys.add(normalized);
    }

    let malformed = 0;
    const broken: { row: CsvRow; value: string }[] = [];
    let scanned = 0;
    for (const row of dataRows(sourceTable)) {
      const raw = row.cells[column]?.text.trim() ?? "";
      if (raw === "") continue;
      scanned += 1;
      const parts = raw.split(separator).map((part) => part.trim());
      const partValue = parts[entry.part];
      if (partValue === undefined || partValue === "") {
        malformed += 1;
        broken.push({ row, value: raw });
        continue;
      }
      const normalized = normalize(partValue, entry.cast);
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
        anchors.push(input.registerAnchor("B", entry.csvPath, cellSpan(cell), "csv"));
      }
    }
    anchors.push(input.registerAnchor("B", entry.targetPath, rowSpan(targetHeader), "csv"));
    const shown = witnesses
      .map((witness) => `"${witness.value}" (line ${witness.row.line})`)
      .join(", ");
    const unmatched = broken.length - malformed;

    findings.push({
      id: idBase,
      ruleId: "REF-02",
      severity: "major",
      confidence: "exact",
      effectConfidence: "inferred",
      title: "Structured cell part has no target row",
      message:
        `${String(broken.length)} cell(s) in ${entry.csvPath} column "${entry.column}" have a ` +
        `part ${String(entry.part)} that does not resolve against ${entry.targetPath} ` +
        `(split "${separator}", cast ${entry.cast}); ${String(malformed)} malformed, ` +
        `${String(unmatched)} missing target: ${shown}` +
        `${broken.length > witnesses.length ? `, +${String(broken.length - witnesses.length)} more` : ""}. ` +
        "A load-time lookup falls back or ignores that part; the rest of the cell is not interpreted.",
      anchors,
      derivation: [
        `The structured cell is pinned (readerProfile.structuredCells): ${entry.csvPath}."${entry.column}" → ${entry.targetPath}.`,
        `Part ${String(entry.part)} selected after splitting on "${separator}" (zero-based).`,
        `The target row key is pinned (pin-row-key): ${targetKey.columns.map((index) => `"${columnLabelOf(targetTable, index)}"`).join(", ")} (exact).`,
        `Matching uses cast ${entry.cast}: ${entry.cast === "int" ? "numeric, so leading zeros compare equal" : "exact string equality"}.`,
        `Compared ${String(scanned)} non-empty cell(s) with ${String(targetKeys.size)} target key(s); ${String(malformed)} part(s) were absent or empty.`,
      ],
    });
  }
  return findings;
}

function columnLabelOf(table: CsvTable, column: number): string {
  return table.rows[0]?.cells[column]?.text.trim() ?? `#${String(column)}`;
}

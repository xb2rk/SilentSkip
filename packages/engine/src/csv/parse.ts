import type { CsvAnomaly, CsvLineEnding, CsvRow, CsvTable } from "./types.js";

/** Default delimiter for FC config CSV; `.tsv` callers pass a tab explicitly (no sniffing). */
const DEFAULT_DELIMITER = ",";
const QUOTE = '"';
const BOM = "\uFEFF";

/**
 * Parse a delimited CSV/TSV source into rows and cells with exact source coordinates.
 *
 * Raw-faithful by design — the parser never drops or reshapes data:
 * - Every record becomes a row, including ragged rows, empty lines and the header.
 * - `raw` is the exact source slice; `offset`/`length` locate it in the original string
 *   (UTF-16 code units, BOM included) so anchors map 1:1 to the file.
 * - A quoted cell may span physical lines; `row.line`/`row.endLine` track both ends.
 * - Malformed input (unterminated quote) still yields its rows; the problem is reported in
 *   `anomalies` instead of being silently repaired.
 * - Characters between a closing quote and the next delimiter are kept verbatim in `text`
 *   (the parser does not invent an interpretation).
 *
 * Deterministic: a pure function of `source` — no clocks, no randomness.
 */
export function parseCsv(source: string, delimiter: string = DEFAULT_DELIMITER): CsvTable {
  const rows: CsvRow[] = [];
  const anomalies: CsvAnomaly[] = [];
  const endings = new Set<"lf" | "crlf" | "cr">();

  const hasBom = source.startsWith(BOM);
  let pos = hasBom ? 1 : 0;
  let line = 1;

  while (pos < source.length) {
    const rowOffset = pos;
    const rowLine = line;
    const cells: CsvRow["cells"] = [];

    let recordDone = false;
    while (!recordDone) {
      const cellOffset = pos;
      const cellLine = line;
      let text = "";
      let raw = "";

      if (source.charAt(pos) === QUOTE) {
        let i = pos + 1;
        let closed = false;
        while (i < source.length) {
          const ch = source.charAt(i);
          if (ch === QUOTE) {
            if (source.charAt(i + 1) === QUOTE) {
              text += QUOTE;
              i += 2;
              continue;
            }
            closed = true;
            i += 1;
            break;
          }
          if (ch === "\n") line += 1;
          else if (ch === "\r" && source.charAt(i + 1) !== "\n") line += 1;
          text += ch;
          i += 1;
        }
        if (!closed) anomalies.push({ kind: "unterminated-quote", line: cellLine });
        while (i < source.length) {
          const ch = source.charAt(i);
          if (ch === delimiter || ch === "\n" || ch === "\r") break;
          text += ch;
          i += 1;
        }
        raw = source.slice(cellOffset, i);
        pos = i;
      } else {
        let i = pos;
        while (i < source.length) {
          const ch = source.charAt(i);
          if (ch === delimiter || ch === "\n" || ch === "\r") break;
          i += 1;
        }
        raw = source.slice(pos, i);
        text = raw;
        pos = i;
      }

      cells.push({
        column: cells.length,
        text,
        raw,
        offset: cellOffset,
        length: raw.length,
        line: cellLine,
      });

      if (source.charAt(pos) === delimiter) {
        pos += 1;
        continue;
      }
      recordDone = true;
    }

    let ending: "lf" | "crlf" | "cr" | null = null;
    let terminatorLength = 0;
    if (source.startsWith("\r\n", pos)) {
      ending = "crlf";
      terminatorLength = 2;
    } else if (source.charAt(pos) === "\n") {
      ending = "lf";
      terminatorLength = 1;
    } else if (source.charAt(pos) === "\r") {
      ending = "cr";
      terminatorLength = 1;
    }

    if (ending !== null) {
      endings.add(ending);
      const rawEnd = pos;
      pos += terminatorLength;
      line += 1;
      rows.push({
        index: rows.length,
        cells,
        raw: source.slice(rowOffset, rawEnd),
        offset: rowOffset,
        length: rawEnd - rowOffset,
        line: rowLine,
        endLine: line - 1,
      });
    } else {
      rows.push({
        index: rows.length,
        cells,
        raw: source.slice(rowOffset, pos),
        offset: rowOffset,
        length: pos - rowOffset,
        line: rowLine,
        endLine: line,
      });
      break;
    }
  }

  return { rows, lineEnding: resolveLineEnding(endings), hasBom, anomalies };
}

/** Table delimiter by extension: `.tsv` is tab-separated; every other table is comma-separated. */
export function delimiterForPath(path: string): string {
  return path.toLowerCase().endsWith(".tsv") ? "\t" : DEFAULT_DELIMITER;
}

/** Collapse the observed terminator set into the table-level classification. */
function resolveLineEnding(endings: ReadonlySet<"lf" | "crlf" | "cr">): CsvLineEnding {
  if (endings.size === 0) return "lf";
  if (endings.size > 1) return "mixed";
  for (const ending of endings) return ending;
  return "lf";
}

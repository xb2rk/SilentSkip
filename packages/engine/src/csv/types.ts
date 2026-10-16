/**
 * CSV table model — parsed records with exact source coordinates.
 *
 * Coordinates use UTF-16 code units (JavaScript string indexing) so every `raw` maps 1:1
 * back to the source file and UI anchors can point at real lines. Lines are 1-based
 * (editor convention); columns and offsets are 0-based.
 */

/** A single parsed cell. */
export interface CsvCell {
  /** Column index within its row (0-based, counts empty cells). */
  column: number;
  /** Resolved cell value: quotes removed, `""` unescaped. Equals `raw` for unquoted cells. */
  text: string;
  /** Exact source slice of the cell — quotes included when the cell was quoted. */
  raw: string;
  /** 0-based UTF-16 offset of `raw` within the full source (BOM included). */
  offset: number;
  /** Length of `raw` in UTF-16 code units. */
  length: number;
  /** 1-based physical line where the cell starts. */
  line: number;
}

/** A single parsed record (physical line, or several when a quoted cell wraps). */
export interface CsvRow {
  /** 0-based index among all records in file order (header included). */
  index: number;
  /** Cells in column order; ragged rows keep their real width — nothing is padded or dropped. */
  cells: CsvCell[];
  /** Exact source slice of the record, excluding its terminator. */
  raw: string;
  /** 0-based UTF-16 offset of `raw` within the full source. */
  offset: number;
  /** Length of `raw` in UTF-16 code units. */
  length: number;
  /** 1-based physical line where the record starts. */
  line: number;
  /** 1-based physical line where the record ends (greater than `line` when a cell wraps). */
  endLine: number;
}

/**
 * Line terminator style observed in the file.
 * `"mixed"` means the file is not uniform (any combination, lone `\r` included).
 */
export type CsvLineEnding = "lf" | "crlf" | "cr" | "mixed";

/** Structural problem found while parsing; reported instead of silently repairing data. */
export interface CsvAnomaly {
  /** `unterminated-quote`: a quoted cell reached end-of-file without a closing quote. */
  kind: "unterminated-quote";
  /** 1-based line where the malformed cell starts. */
  line: number;
}

/** A parsed CSV file. */
export interface CsvTable {
  /** All records in file order, header included. Ragged rows and empty lines are preserved. */
  rows: CsvRow[];
  /** Dominant terminator style; `"lf"` when the file has no terminators at all. */
  lineEnding: CsvLineEnding;
  /** True when the source started with a UTF-8 BOM. */
  hasBom: boolean;
  /** Problems found while parsing — empty for well-formed files. */
  anomalies: CsvAnomaly[];
}

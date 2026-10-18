import type { CsvTable } from "@silentskip/engine";
import { expect } from "vitest";

/**
 * Assert the raw-faithfulness contract of a parsed table: every `raw` slice and every
 * coordinate must map exactly back into `source`. Shared by the engineered cases and the
 * checked-in corpus gate.
 */
export function expectRawFaithful(source: string, table: CsvTable): void {
  for (const row of table.rows) {
    expect(source.slice(row.offset, row.offset + row.length)).toBe(row.raw);
    expect(row.endLine).toBeGreaterThanOrEqual(row.line);
    for (const cell of row.cells) {
      expect(source.slice(cell.offset, cell.offset + cell.length)).toBe(cell.raw);
      expect(cell.line).toBeGreaterThanOrEqual(row.line);
      expect(cell.line).toBeLessThanOrEqual(row.endLine);
    }
  }
}

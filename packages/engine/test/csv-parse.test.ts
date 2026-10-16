import { parseCsv } from "@craftland-qa/engine";
import { describe, expect, it } from "vitest";
import { expectRawFaithful } from "./helpers/invariants.js";

/**
 * Engineered edge cases for the raw-faithful CSV parser. Sources are inline strings so the
 * exact bytes (BOM, CRLF, lone CR) are under test control.
 */
describe("parseCsv", () => {
  it("parses a basic LF table with a trailing newline and no phantom row", () => {
    const source = "a,b,c\n1,2,3\n";
    const table = parseCsv(source);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]?.cells.map((c) => c.text)).toEqual(["a", "b", "c"]);
    expect(table.rows[1]?.cells.map((c) => c.text)).toEqual(["1", "2", "3"]);
    expect(table.lineEnding).toBe("lf");
    expect(table.hasBom).toBe(false);
    expect(table.anomalies).toEqual([]);
    expectRawFaithful(source, table);
  });

  it("keeps a file without trailing newline to exactly its rows", () => {
    const table = parseCsv("a,b");
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]?.cells.map((c) => c.text)).toEqual(["a", "b"]);
  });

  it("handles BOM, CRLF, embedded commas and escaped quotes", () => {
    const source = '\uFEFFh1,h2\r\n"a, b","c""d"\r\n';
    const table = parseCsv(source);
    expect(table.hasBom).toBe(true);
    expect(table.lineEnding).toBe("crlf");
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1]?.cells[0]?.text).toBe("a, b");
    expect(table.rows[1]?.cells[0]?.raw).toBe('"a, b"');
    expect(table.rows[1]?.cells[1]?.text).toBe('c"d');
    expectRawFaithful(source, table);
  });

  it("keeps quoted cells that span physical lines with correct line spans", () => {
    const source = 'id,note\n1,"line one\nline two"\n2,x\n';
    const table = parseCsv(source);
    expect(table.rows).toHaveLength(3);
    const wrapped = table.rows[1];
    expect(wrapped?.cells[1]?.text).toBe("line one\nline two");
    expect(wrapped?.line).toBe(2);
    expect(wrapped?.endLine).toBe(3);
    expect(table.rows[2]?.line).toBe(4);
    expectRawFaithful(source, table);
  });

  it("preserves ragged rows and interior empty lines — nothing is padded or dropped", () => {
    const source = "a,b\n1,2,3\n\n4\n";
    const table = parseCsv(source);
    expect(table.rows.map((r) => r.cells.length)).toEqual([2, 3, 1, 1]);
    expect(table.rows[2]?.cells[0]?.text).toBe("");
    expect(table.rows[2]?.raw).toBe("");
    expectRawFaithful(source, table);
  });

  it("reports an unterminated quote as an anomaly instead of repairing it", () => {
    const source = 'a,b\n1,"oops\n';
    const table = parseCsv(source);
    expect(table.rows).toHaveLength(2);
    expect(table.anomalies).toEqual([{ kind: "unterminated-quote", line: 2 }]);
    expect(table.rows[1]?.cells[1]?.text).toBe("oops\n");
    expectRawFaithful(source, table);
  });

  it("treats semicolons as literal data (comma-only contract, no sniffing)", () => {
    const table = parseCsv("a;b,c\n");
    expect(table.rows[0]?.cells.map((c) => c.text)).toEqual(["a;b", "c"]);
  });

  it("recognizes lone-CR terminators and mixed files", () => {
    const loneCr = parseCsv("a\rb\r");
    expect(loneCr.rows).toHaveLength(2);
    expect(loneCr.lineEnding).toBe("cr");
    const mixed = parseCsv("a\nb\r\n");
    expect(mixed.lineEnding).toBe("mixed");
    expect(mixed.rows).toHaveLength(2);
  });

  it("is deterministic: parsing the same source twice yields identical tables", () => {
    const source = 'a,"b\nc",d\r\n1,2,"3""4"\n';
    expect(parseCsv(source)).toEqual(parseCsv(source));
  });
});

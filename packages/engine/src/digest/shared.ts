import { createHash } from "node:crypto";
import type { Anchor, AnchorLoc, DigestWidthEntry } from "@silentskip/contracts";
import type { CsvCell, CsvRow, CsvTable } from "../csv/index.js";
import type { FactSpan, FileFacts } from "../facts/index.js";

/** Script (FC source) extensions the digest understands. */
export const SCRIPT_EXTENSION = /\.(fcc|fcg)$/iu;

/** Table extensions the digest understands. */
export const TABLE_EXTENSION = /\.(csv|tsv)$/iu;

/** Git blob hash - `sha1("blob <byteLength>\0" + content)`, byte-identical to what git stores. */
export function gitBlobSha(content: string): string {
  const header = `blob ${Buffer.byteLength(content, "utf8")}\0`;
  return createHash("sha1").update(header, "utf8").update(content, "utf8").digest("hex");
}

/** Deterministic code-unit string order — independent of any locale. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Span of one raw CSV row, used for row-level anchors. */
export function rowSpan(row: CsvRow): FactSpan {
  return { offset: row.offset, length: row.length, line: row.line, endLine: row.endLine };
}

/** Span of one raw CSV cell, used for cell-level anchors. */
export function cellSpan(cell: CsvCell): FactSpan {
  return { offset: cell.offset, length: cell.length, line: cell.line, endLine: cell.line };
}

/** Maps symbol id → raw literal initializer text for one file's facts. */
export function valueMap(file: FileFacts | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const value of file?.values ?? []) map.set(value.symbolId, value.rawText);
  return map;
}

/** Distinct data-row widths with row counts — raw CSV structure, nothing inferred. */
export function widthSummary(table: CsvTable | undefined): DigestWidthEntry[] {
  if (table === undefined) return [];
  const counts = new Map<number, number>();
  for (const row of table.rows) {
    if (row.index === 0) continue;
    counts.set(row.cells.length, (counts.get(row.cells.length) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([width, rows]) => ({ width, rows }))
    .sort((a, b) => a.width - b.width);
}

/** Sum of a selected numeric field over items. */
export function sumBy<T>(items: readonly T[], select: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += select(item);
  return total;
}

/**
 * Content-stable anchor registry. The same ref + file + lines + kind + loc always yields
 * the same id, so pins and citations survive re-runs. Anchors are never dropped once
 * referenced — the budget is recorded, not enforced by breaking references.
 */
export class AnchorRegistry {
  private readonly anchors = new Map<string, Anchor>();
  private readonly blobShas = new Map<string, string>();

  private blobShaFor(ref: "A" | "B", file: string, source: string): string {
    const key = `${ref}:${file}`;
    const cached = this.blobShas.get(key);
    if (cached !== undefined) return cached;
    const sha = gitBlobSha(source);
    this.blobShas.set(key, sha);
    return sha;
  }

  /** Registers the anchor for a span and returns its id (idempotent per id). */
  add(
    ref: "A" | "B",
    file: string,
    source: string,
    span: FactSpan,
    kind: Anchor["kind"],
    loc?: AnchorLoc,
  ): string {
    const parts = [ref, file, String(span.line), String(span.endLine), kind];
    if (loc?.rowKey !== undefined) parts.push(`r:${loc.rowKey}`);
    if (loc?.column !== undefined) parts.push(`c:${String(loc.column)}`);
    const id = parts.join(":");
    if (!this.anchors.has(id)) {
      const base: Anchor = {
        id,
        ref,
        file,
        blobSha: this.blobShaFor(ref, file, source),
        lineStart: span.line,
        lineEnd: span.endLine,
        snippet: source.slice(span.offset, span.offset + span.length),
        kind,
      };
      this.anchors.set(id, loc === undefined ? base : { ...base, loc });
    }
    return id;
  }

  /** All registered anchors, sorted by id. */
  list(): Anchor[] {
    return [...this.anchors.values()].sort((a, b) => compareStrings(a.id, b.id));
  }
}

/** One parsed side of the comparison: sources, facts and tables, all keyed by path. */
export interface DigestSide {
  sources: ReadonlyMap<string, string>;
  bundle: import("../facts/index.js").FactBundle;
  factsByPath: ReadonlyMap<string, FileFacts>;
  tables: ReadonlyMap<string, CsvTable>;
}

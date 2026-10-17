/**
 * Reading plan (E7.1) — a deterministic, lossless compaction of everything that changed.
 *
 * The plan is what the AI flow (E7.2) reads: every changed file appears exactly once across
 * the units; unit payloads keep every changed name and value (compaction drops only repeats
 * and formatting, never information). Units are packed in path order under a byte budget so a
 * huge range becomes several honest units instead of one silently truncated prompt.
 *
 * The plan input is a thin structural adapter — the digest maps its change facts into
 * `PlanScriptInput`/`PlanTableInput` so this module stays independent of contract schemas.
 */

import type { SymbolKind } from "../facts/index.js";

/** Default per-unit payload budget in bytes (~60 KB keeps a unit comfortably readable). */
export const DEFAULT_UNIT_BUDGET_BYTES = 60_000;

/** One named symbol entry inside a plan payload. */
export interface PlanSymbolEntry {
  readonly name: string;
  readonly kind: SymbolKind;
  /** Raw literal initializer when one exists — values are the primary payload. */
  readonly value?: string;
}

/** One changed symbol with both raw literal initializers, when they exist. */
export interface PlanSymbolChange {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly beforeValue?: string;
  readonly afterValue?: string;
}

/** Compact script-file input for the plan. */
export interface PlanScriptInput {
  readonly path: string;
  readonly status: "added" | "removed" | "changed";
  readonly language: "fcc" | "fcg";
  readonly importsAdded: readonly string[];
  readonly importsRemoved: readonly string[];
  readonly symbolsAdded: readonly PlanSymbolEntry[];
  readonly symbolsRemoved: readonly PlanSymbolEntry[];
  readonly symbolsChanged: readonly PlanSymbolChange[];
}

/** One changed cell with its column label and both raw values. */
export interface PlanCellChange {
  readonly column: string;
  readonly before: string;
  readonly after: string;
}

/** One changed CSV row keyed like the delta. */
export interface PlanRowChange {
  readonly key: string;
  readonly cells: readonly PlanCellChange[];
}

/** Compact table-file input for the plan. */
export interface PlanTableInput {
  readonly path: string;
  readonly status: "added" | "removed" | "changed";
  readonly headerChanged: boolean;
  readonly beforeColumns: number | null;
  readonly afterColumns: number | null;
  readonly rowsAdded: readonly string[];
  readonly rowsRemoved: readonly string[];
  readonly rowsChanged: readonly PlanRowChange[];
}

/** Input for {@link buildReadingPlan}. */
export interface PlanInput {
  readonly scripts: readonly PlanScriptInput[];
  readonly tables: readonly PlanTableInput[];
  /** Directed import edges among changed files (relation-derived, both endpoints changed). */
  readonly graphEdges: readonly { readonly from: string; readonly to: string }[];
  /** Optional override of the per-unit byte budget. */
  readonly unitBudgetBytes?: number;
}

/** One reading unit: the files it covers and its already-compacted payload. */
export interface PlanUnit {
  /** 0-based unit index in path order. */
  readonly index: number;
  /** Changed file paths covered by this unit, in path order. */
  readonly files: string[];
  /** Byte length of {@link payload} (UTF-8). */
  readonly estimatedBytes: number;
  /** Compact JSON payload — every changed name and value, nothing invented. */
  readonly payload: string;
}

/** Per-file skeleton entry — the whole change map, cheap to read. */
export interface PlanSkeletonFile {
  readonly path: string;
  readonly kind: "script" | "table";
  readonly status: "added" | "removed" | "changed";
  readonly language?: "fcc" | "fcg";
  readonly counts: {
    readonly added: number;
    readonly removed: number;
    readonly changed: number;
  };
  /** Names of symbols whose declarations changed (the narrative anchors of a file). */
  readonly changedSymbols: string[];
  /** Header cell count on the current side (falling back to the base side). */
  readonly headerColumns: number | null;
}

/** Directed import edge between two changed files. */
export interface PlanSkeletonEdge {
  readonly from: string;
  readonly to: string;
}

/** The full change map: every changed file plus import edges among them. */
export interface PlanSkeleton {
  readonly files: PlanSkeletonFile[];
  readonly importEdges: PlanSkeletonEdge[];
}

/** A deterministic cluster of changed files (base partition; AI may only refine it later). */
export interface PlanCluster {
  readonly id: string;
  readonly files: string[];
}

/** Base partition of changed files derived from the import graph and the filesystem. */
export interface PlanPartition {
  readonly clusters: PlanCluster[];
}

/** The reading plan: units + skeleton + base partition. */
export interface ReadingPlan {
  readonly units: PlanUnit[];
  readonly skeleton: PlanSkeleton;
  readonly partition: PlanPartition;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function scriptPayload(script: PlanScriptInput): string {
  return JSON.stringify({
    path: script.path,
    status: script.status,
    language: script.language,
    importsAdded: script.importsAdded,
    importsRemoved: script.importsRemoved,
    symbolsAdded: script.symbolsAdded,
    symbolsRemoved: script.symbolsRemoved,
    symbolsChanged: script.symbolsChanged,
  });
}

function tablePayload(table: PlanTableInput): string {
  return JSON.stringify({
    path: table.path,
    status: table.status,
    headerChanged: table.headerChanged,
    columns: { before: table.beforeColumns, after: table.afterColumns },
    rowsAdded: table.rowsAdded,
    rowsRemoved: table.rowsRemoved,
    rowsChanged: table.rowsChanged,
  });
}

/** Packs file payloads into units in path order under the byte budget; files are never split. */
function packUnits(
  entries: readonly { path: string; payload: string }[],
  budget: number,
): PlanUnit[] {
  const units: PlanUnit[] = [];
  let files: string[] = [];
  let payloads: string[] = [];
  let bytes = 0;
  const flush = (): void => {
    if (files.length === 0) return;
    const payload = `[${payloads.join(",")}]`;
    units.push({
      index: units.length,
      files,
      estimatedBytes: Buffer.byteLength(payload, "utf8"),
      payload,
    });
    files = [];
    payloads = [];
    bytes = 0;
  };
  for (const entry of entries) {
    const entryBytes = Buffer.byteLength(entry.payload, "utf8") + 1;
    if (files.length > 0 && bytes + entryBytes > budget) flush();
    files.push(entry.path);
    payloads.push(entry.payload);
    bytes += entryBytes;
  }
  flush();
  return units;
}

/** Union-find over changed files: import edges plus same-directory grouping. */
function buildPartition(
  paths: readonly string[],
  edges: readonly PlanSkeletonEdge[],
): PlanPartition {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    let current = x;
    while (current !== root) {
      const next = parent.get(current) ?? root;
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  for (const path of paths) parent.set(path, path);
  for (const edge of edges) {
    if (parent.has(edge.from) && parent.has(edge.to)) union(edge.from, edge.to);
  }
  const byDirectory = new Map<string, string[]>();
  for (const path of paths) {
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const list = byDirectory.get(dir);
    if (list === undefined) byDirectory.set(dir, [path]);
    else list.push(path);
  }
  for (const list of byDirectory.values()) {
    for (let i = 1; i < list.length; i++) {
      const first = list[0];
      const other = list[i];
      if (first !== undefined && other !== undefined) union(first, other);
    }
  }
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const root = find(path);
    const list = groups.get(root);
    if (list === undefined) groups.set(root, [path]);
    else list.push(path);
  }
  const clusters = [...groups.values()]
    .map((files) => files.slice().sort(compareStrings))
    .sort((a, b) => b.length - a.length || compareStrings(a[0] ?? "", b[0] ?? ""));
  return {
    clusters: clusters.map((files, index) => ({ id: `cluster-${index + 1}`, files })),
  };
}

/** Builds the reading plan: skeleton, base partition, then budget-packed units in path order. */
export function buildReadingPlan(input: PlanInput): ReadingPlan {
  const scripts = [...input.scripts].sort((a, b) => compareStrings(a.path, b.path));
  const tables = [...input.tables].sort((a, b) => compareStrings(a.path, b.path));
  const paths = [...scripts.map((s) => s.path), ...tables.map((t) => t.path)].sort(compareStrings);

  const edges: PlanSkeletonEdge[] = [];
  const seenEdges = new Set<string>();
  for (const edge of input.graphEdges) {
    if (edge.from === edge.to) continue;
    const key = `${edge.from}\u0000${edge.to}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push({ from: edge.from, to: edge.to });
  }
  edges.sort((a, b) => compareStrings(a.from, b.from) || compareStrings(a.to, b.to));

  const skeletonFiles: PlanSkeletonFile[] = [
    ...scripts.map((script): PlanSkeletonFile => {
      const entry: PlanSkeletonFile = {
        path: script.path,
        kind: "script",
        status: script.status,
        language: script.language,
        counts: {
          added: script.symbolsAdded.length,
          removed: script.symbolsRemoved.length,
          changed: script.symbolsChanged.length,
        },
        changedSymbols: script.symbolsChanged.map((s) => s.name),
        headerColumns: null,
      };
      return entry;
    }),
    ...tables.map(
      (table): PlanSkeletonFile => ({
        path: table.path,
        kind: "table",
        status: table.status,
        counts: {
          added: table.rowsAdded.length,
          removed: table.rowsRemoved.length,
          changed: table.rowsChanged.length,
        },
        changedSymbols: [],
        headerColumns: table.afterColumns ?? table.beforeColumns,
      }),
    ),
  ].sort((a, b) => compareStrings(a.path, b.path));

  const entries = [
    ...scripts.map((script) => ({ path: script.path, payload: scriptPayload(script) })),
    ...tables.map((table) => ({ path: table.path, payload: tablePayload(table) })),
  ].sort((a, b) => compareStrings(a.path, b.path));

  return {
    units: packUnits(entries, input.unitBudgetBytes ?? DEFAULT_UNIT_BUDGET_BYTES),
    skeleton: { files: skeletonFiles, importEdges: edges },
    partition: buildPartition(paths, edges),
  };
}

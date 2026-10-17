import { createHash } from "node:crypto";
import type {
  Anchor,
  AnchorLoc,
  DigestBundle,
  DigestCellChange,
  DigestContextItem,
  DigestJourneyChain,
  DigestJourneyNode,
  DigestLinked,
  DigestRowChange,
  DigestRowRef,
  DigestScriptChange,
  DigestSymbolChange,
  DigestSymbolRef,
  DigestTableChange,
  ProjectProfile,
} from "@craftland-qa/contracts";
import { type CsvCell, type CsvRow, type CsvTable, parseCsv } from "../csv/index.js";
import {
  buildDeltaBundle,
  type CsvRowRef,
  type CsvTableDelta,
  type ScriptFileDelta,
} from "../delta/index.js";
import {
  buildFactBundle,
  type FactBundle,
  type FactSpan,
  type FileFacts,
  type SourceInput,
} from "../facts/index.js";
import { buildJourney, type JourneyNode, type JourneyOrigin } from "../journey/index.js";
import { buildRelations } from "../relations/index.js";
import {
  DEFAULT_MAX_ANCHORS,
  DEFAULT_MAX_JOURNEYS,
  DIGEST_SCHEMA_VERSION,
  type DigestInput,
} from "./types.js";

const SCRIPT_EXTENSION = /\.(fcc|fcg)$/iu;
const TABLE_EXTENSION = /\.(csv|tsv)$/iu;

/** Git blob hash — `sha1("blob <byteLength>\0" + content)`, byte-identical to what git stores. */
function gitBlobSha(content: string): string {
  const header = `blob ${Buffer.byteLength(content, "utf8")}\0`;
  return createHash("sha1").update(header, "utf8").update(content, "utf8").digest("hex");
}

/** Deterministic code-unit string order — independent of any locale. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function rowSpan(row: CsvRow): FactSpan {
  return { offset: row.offset, length: row.length, line: row.line, endLine: row.endLine };
}

function cellSpan(cell: CsvCell): FactSpan {
  return { offset: cell.offset, length: cell.length, line: cell.line, endLine: cell.line };
}

function sumBy<T>(items: readonly T[], select: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += select(item);
  return total;
}

/**
 * Content-stable anchor registry. The same ref + file + lines + kind + loc always yields
 * the same id, so pins and citations survive re-runs. Anchors are never dropped once
 * referenced — the budget is recorded, not enforced by breaking references.
 */
class AnchorRegistry {
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
interface DigestSide {
  sources: ReadonlyMap<string, string>;
  bundle: FactBundle;
  factsByPath: ReadonlyMap<string, FileFacts>;
  tables: ReadonlyMap<string, CsvTable>;
}

function buildSide(sources: readonly SourceInput[]): DigestSide {
  const scripts: SourceInput[] = [];
  const tables: SourceInput[] = [];
  const sourceMap = new Map<string, string>();
  for (const source of sources) {
    if (sourceMap.has(source.path)) {
      throw new Error(`Duplicate digest source path: ${source.path}`);
    }
    sourceMap.set(source.path, source.source);
    if (SCRIPT_EXTENSION.test(source.path)) scripts.push(source);
    else if (TABLE_EXTENSION.test(source.path)) tables.push(source);
    else throw new Error(`Unsupported digest source extension: ${source.path}`);
  }
  const bundle = buildFactBundle(scripts);
  const factsByPath = new Map(bundle.files.map((file) => [file.path, file]));
  const tableMap = new Map<string, CsvTable>();
  for (const table of tables) tableMap.set(table.path, parseCsv(table.source));
  return { sources: sourceMap, bundle, factsByPath, tables: tableMap };
}

/** Layer 1 — one changed script file, anchored on both sides. */
function buildScriptChange(
  delta: ScriptFileDelta,
  base: DigestSide,
  current: DigestSide,
  registry: AnchorRegistry,
): DigestScriptChange {
  const beforeSource = base.sources.get(delta.path);
  const afterSource = current.sources.get(delta.path);

  const symbolsAdded: DigestSymbolRef[] = [];
  const symbolsRemoved: DigestSymbolRef[] = [];
  const symbolsChanged: DigestSymbolChange[] = [];

  if (afterSource !== undefined) {
    for (const symbol of delta.symbolsAdded) {
      symbolsAdded.push({
        name: symbol.name,
        symbolKind: symbol.kind,
        anchorId: registry.add("B", delta.path, afterSource, symbol.nameSpan, "code"),
      });
    }
  }
  if (beforeSource !== undefined) {
    for (const symbol of delta.symbolsRemoved) {
      symbolsRemoved.push({
        name: symbol.name,
        symbolKind: symbol.kind,
        anchorId: registry.add("A", delta.path, beforeSource, symbol.nameSpan, "code"),
      });
    }
  }
  for (const change of delta.symbolsChanged) {
    if (afterSource === undefined || beforeSource === undefined) continue;
    symbolsChanged.push({
      name: change.name,
      symbolKind: change.kind,
      beforeAnchorId: registry.add("A", delta.path, beforeSource, change.beforeSpan, "code"),
      afterAnchorId: registry.add("B", delta.path, afterSource, change.afterSpan, "code"),
    });
  }

  return {
    kind: "script",
    path: delta.path,
    status: delta.status,
    language: delta.language,
    symbolsAdded,
    symbolsRemoved,
    symbolsChanged,
    importsAdded: delta.importsAdded.map((imp) => imp.path),
    importsRemoved: delta.importsRemoved.map((imp) => imp.path),
  };
}

/** Layer 1 — one changed CSV table, with row and cell anchors. */
function buildTableChange(
  delta: CsvTableDelta,
  base: DigestSide,
  current: DigestSide,
  registry: AnchorRegistry,
): DigestTableChange {
  const beforeTable = base.tables.get(delta.path);
  const afterTable = current.tables.get(delta.path);
  const beforeSource = base.sources.get(delta.path);
  const afterSource = current.sources.get(delta.path);

  const columnLabel = (index: number): string | number => {
    const after = afterTable?.rows[0]?.cells[index]?.text;
    if (after !== undefined) return after;
    const before = beforeTable?.rows[0]?.cells[index]?.text;
    if (before !== undefined) return before;
    return index;
  };

  const rowRef = (
    side: "A" | "B",
    table: CsvTable,
    source: string,
    ref: CsvRowRef,
  ): DigestRowRef | undefined => {
    const row = table.rows[ref.rowIndex];
    if (row === undefined) return undefined;
    const loc =
      ref.keyKind === "first-column" ? ({ rowKey: ref.key } satisfies AnchorLoc) : undefined;
    return {
      key: ref.key,
      keyKind: ref.keyKind,
      line: ref.line,
      text: ref.text,
      anchorId: registry.add(side, delta.path, source, rowSpan(row), "csv", loc),
    };
  };

  const rowsAdded: DigestRowRef[] = [];
  if (afterTable !== undefined && afterSource !== undefined) {
    for (const ref of delta.rowsAdded) {
      const mapped = rowRef("B", afterTable, afterSource, ref);
      if (mapped !== undefined) rowsAdded.push(mapped);
    }
  }

  const rowsRemoved: DigestRowRef[] = [];
  if (beforeTable !== undefined && beforeSource !== undefined) {
    for (const ref of delta.rowsRemoved) {
      const mapped = rowRef("A", beforeTable, beforeSource, ref);
      if (mapped !== undefined) rowsRemoved.push(mapped);
    }
  }

  const rowsChanged: DigestRowChange[] = [];
  if (
    beforeTable !== undefined &&
    afterTable !== undefined &&
    beforeSource !== undefined &&
    afterSource !== undefined
  ) {
    for (const rowChange of delta.rowsChanged) {
      const beforeRow = beforeTable.rows[rowChange.before.rowIndex];
      const afterRow = afterTable.rows[rowChange.after.rowIndex];
      if (beforeRow === undefined || afterRow === undefined) continue;
      const rowKey = rowChange.keyKind === "first-column" ? rowChange.key : undefined;
      const columnsChanged: DigestCellChange[] = [];
      for (const columnIndex of rowChange.columnsChanged) {
        const beforeCell = beforeRow.cells[columnIndex];
        const afterCell = afterRow.cells[columnIndex];
        if (beforeCell === undefined || afterCell === undefined) continue;
        const column = columnLabel(columnIndex);
        const beforeLoc: AnchorLoc = rowKey !== undefined ? { rowKey, column } : { column };
        const afterLoc: AnchorLoc = rowKey !== undefined ? { rowKey, column } : { column };
        columnsChanged.push({
          column,
          before: beforeCell.text,
          after: afterCell.text,
          beforeAnchorId: registry.add(
            "A",
            delta.path,
            beforeSource,
            cellSpan(beforeCell),
            "csv",
            beforeLoc,
          ),
          afterAnchorId: registry.add(
            "B",
            delta.path,
            afterSource,
            cellSpan(afterCell),
            "csv",
            afterLoc,
          ),
        });
      }
      rowsChanged.push({
        key: rowChange.key,
        keyKind: rowChange.keyKind,
        columnsChanged,
        beforeLine: rowChange.before.line,
        afterLine: rowChange.after.line,
      });
    }
  }

  return {
    kind: "table",
    path: delta.path,
    status: delta.status,
    headerChanged: delta.headerChanged,
    rowsAdded,
    rowsRemoved,
    rowsChanged,
  };
}

/** A changed origin eligible for a journey walk on the current side. */
interface JourneyCandidate {
  origin: JourneyOrigin;
  originKind: "csv-table" | "csv-row" | "symbol";
  originLabel: string;
  file: string;
  offset: number;
  anchorId: string | null;
  /** Selection priority — lower wins (changed tables → changed rows → changed symbols → added symbols). */
  priority: number;
}

function collectJourneyCandidates(
  deltaScripts: readonly ScriptFileDelta[],
  deltaTables: readonly CsvTableDelta[],
  current: DigestSide,
  registry: AnchorRegistry,
): JourneyCandidate[] {
  const candidates: JourneyCandidate[] = [];

  for (const table of deltaTables) {
    const afterTable = current.tables.get(table.path);
    const afterSource = current.sources.get(table.path);
    if (afterTable === undefined || afterSource === undefined) continue;

    if (table.status === "added") {
      const header = afterTable.rows[0];
      const anchorId =
        header !== undefined
          ? registry.add("B", table.path, afterSource, rowSpan(header), "csv")
          : null;
      candidates.push({
        origin: { kind: "csv", path: table.path },
        originKind: "csv-table",
        originLabel: table.path,
        file: table.path,
        offset: 0,
        anchorId,
        priority: 0,
      });
    }

    for (const ref of [...table.rowsAdded, ...table.rowsChanged.map((change) => change.after)]) {
      const row = afterTable.rows[ref.rowIndex];
      if (row === undefined) continue;
      const loc =
        ref.keyKind === "first-column" ? ({ rowKey: ref.key } satisfies AnchorLoc) : undefined;
      candidates.push({
        origin: { kind: "csv", path: table.path, rowKey: ref.key },
        originKind: "csv-row",
        originLabel: `${table.path}#${ref.key}`,
        file: table.path,
        offset: row.offset,
        anchorId: registry.add("B", table.path, afterSource, rowSpan(row), "csv", loc),
        priority: 1,
      });
    }
  }

  for (const script of deltaScripts) {
    const afterSource = current.sources.get(script.path);
    const afterFacts = current.factsByPath.get(script.path);
    if (afterSource === undefined || afterFacts === undefined) continue;

    for (const symbol of script.symbolsAdded) {
      candidates.push({
        origin: { kind: "symbol", file: script.path, symbolId: symbol.id },
        originKind: "symbol",
        originLabel: symbol.name,
        file: script.path,
        offset: symbol.nameSpan.offset,
        anchorId: registry.add("B", script.path, afterSource, symbol.nameSpan, "code"),
        priority: 3,
      });
    }
    for (const change of script.symbolsChanged) {
      const symbol = afterFacts.symbols.find(
        (candidate) => candidate.span.offset === change.afterSpan.offset,
      );
      if (symbol === undefined) continue;
      candidates.push({
        origin: { kind: "symbol", file: script.path, symbolId: symbol.id },
        originKind: "symbol",
        originLabel: symbol.name,
        file: script.path,
        offset: symbol.nameSpan.offset,
        anchorId: registry.add("B", script.path, afterSource, symbol.nameSpan, "code"),
        priority: 2,
      });
    }
  }

  candidates.sort(
    (a, b) =>
      compareStrings(a.file, b.file) ||
      a.offset - b.offset ||
      compareStrings(a.originLabel, b.originLabel),
  );
  return candidates;
}

/** Per-file caps so one noisy file cannot eat the whole journey budget (spread, not depth). */
const JOURNEY_FILE_CAP: Record<JourneyCandidate["originKind"], number> = {
  "csv-table": 6,
  "csv-row": 12,
  symbol: 4,
};

/**
 * Select journey candidates under the budget: highest-signal origins first (changed tables →
 * changed rows → changed symbols → added symbols), then spread across files with per-file caps.
 * If the caps leave budget unspent (few files), the remaining candidates fill it in priority
 * order. Deterministic — same candidates always produce the same selection.
 */
function selectJourneyCandidates(
  candidates: readonly JourneyCandidate[],
  maxJourneys: number,
): JourneyCandidate[] {
  const sorted = [...candidates].sort(
    (a, b) =>
      a.priority - b.priority ||
      compareStrings(a.file, b.file) ||
      a.offset - b.offset ||
      compareStrings(a.originLabel, b.originLabel),
  );
  const perFileCounts = new Map<string, number>();
  const selected: JourneyCandidate[] = [];
  for (const candidate of sorted) {
    if (selected.length >= maxJourneys) break;
    const key = `${candidate.originKind}|${candidate.file}`;
    const used = perFileCounts.get(key) ?? 0;
    if (used >= JOURNEY_FILE_CAP[candidate.originKind]) continue;
    perFileCounts.set(key, used + 1);
    selected.push(candidate);
  }
  if (selected.length < maxJourneys) {
    const chosen = new Set(selected);
    for (const candidate of sorted) {
      if (selected.length >= maxJourneys) break;
      if (!chosen.has(candidate)) selected.push(candidate);
    }
  }
  return selected;
}

function anchorForJourneyNode(
  node: JourneyNode,
  candidate: JourneyCandidate,
  current: DigestSide,
  registry: AnchorRegistry,
): string | null {
  if (node.span !== undefined) {
    const source = current.sources.get(node.file);
    if (source === undefined) return null;
    const kind: Anchor["kind"] = TABLE_EXTENSION.test(node.file) ? "csv" : "code";
    return registry.add("B", node.file, source, node.span, kind);
  }
  return node.level === 0 ? candidate.anchorId : null;
}

/** Layer 2 — journeys for the selected changed origins, nodes resolved to anchors. */
function buildLinked(
  candidates: readonly JourneyCandidate[],
  maxJourneys: number,
  current: DigestSide,
  relations: ReturnType<typeof buildRelations>,
  registry: AnchorRegistry,
): DigestLinked[] {
  const linked: DigestLinked[] = [];
  for (const candidate of selectJourneyCandidates(candidates, maxJourneys)) {
    const journey = buildJourney({
      bundle: current.bundle,
      relations,
      origin: candidate.origin,
      maxDepth: 2,
    });
    const chains: DigestJourneyChain[] = [];
    for (const chain of journey.chains) {
      const nodes: DigestJourneyNode[] = [];
      for (const node of chain.nodes) {
        const anchorId = anchorForJourneyNode(node, candidate, current, registry);
        if (anchorId === null) continue;
        nodes.push({
          label: node.label,
          nodeKind: node.kind,
          confidence: node.confidence === "origin" ? "exact" : node.confidence,
          anchorId,
        });
      }
      if (nodes.length > 0) chains.push({ nodes });
    }
    linked.push({
      originKind: candidate.originKind,
      originLabel: candidate.originLabel,
      anchorId: candidate.anchorId,
      chains,
      ...(journey.note !== undefined ? { note: journey.note } : {}),
    });
  }
  return linked;
}

/** Layer 4 — doc comments of changed symbols plus pinned profile material. */
function buildContext(
  deltaScripts: readonly ScriptFileDelta[],
  current: DigestSide,
  registry: AnchorRegistry,
  profile: ProjectProfile | undefined,
): DigestContextItem[] {
  const items: DigestContextItem[] = [];

  for (const script of deltaScripts) {
    const afterSource = current.sources.get(script.path);
    const afterFacts = current.factsByPath.get(script.path);
    if (afterSource === undefined || afterFacts === undefined) continue;
    const symbolIds = [
      ...script.symbolsAdded.map((symbol) => symbol.id),
      ...script.symbolsChanged.flatMap((change) => {
        const symbol = afterFacts.symbols.find(
          (candidate) => candidate.span.offset === change.afterSpan.offset,
        );
        return symbol === undefined ? [] : [symbol.id];
      }),
    ];
    for (const symbolId of symbolIds) {
      const comments = afterFacts.docComments
        .filter((comment) => comment.attachedTo === symbolId)
        .slice(0, 2);
      for (const comment of comments) {
        items.push({
          itemKind: "doc-comment",
          text: comment.text,
          source: `${script.path}:${comment.span.line}`,
          anchorId: registry.add("B", script.path, afterSource, comment.span, "code"),
        });
      }
    }
  }

  if (profile !== undefined) {
    for (const convention of profile.conventions) {
      items.push({
        itemKind: "convention",
        text: `${convention.kind}: ${convention.statement}`,
        source: "profile",
        anchorId: null,
      });
    }
    for (const override of profile.overrides) {
      if (override.kind !== "entity-note") continue;
      const text = override.note ?? override.value;
      if (text === undefined) continue;
      items.push({ itemKind: "note", text, source: "profile", anchorId: null });
    }
  }

  return items;
}

/**
 * Builds the deterministic digest fact sheet for one A/B comparison (spec §4.6).
 *
 * Layer 1 = change facts (delta, exact, anchored), layer 2 = journeys for the selected
 * changed origins (budgeted, current side), layer 4 = doc comments of changed symbols and
 * pinned profile material. The manifest records budgets, counts and what was not walked —
 * never silently.
 */
export function buildDigest(input: DigestInput): DigestBundle {
  const maxJourneys = input.budgets?.maxJourneys ?? DEFAULT_MAX_JOURNEYS;
  const maxAnchors = input.budgets?.maxAnchors ?? DEFAULT_MAX_ANCHORS;

  const base = buildSide(input.base.sources);
  const current = buildSide(input.current.sources);
  const registry = new AnchorRegistry();

  const delta = buildDeltaBundle({ before: input.base.sources, after: input.current.sources });
  const relations = buildRelations(current.bundle, { csvPaths: [...current.tables.keys()] });

  const scriptFacts = delta.scripts.map((script) =>
    buildScriptChange(script, base, current, registry),
  );
  const tableFacts = delta.tables.map((table) => buildTableChange(table, base, current, registry));
  const changeFacts: (DigestScriptChange | DigestTableChange)[] = [
    ...scriptFacts,
    ...tableFacts,
  ].sort((a, b) => compareStrings(a.path, b.path));

  const candidates = collectJourneyCandidates(delta.scripts, delta.tables, current, registry);
  const linked = buildLinked(candidates, maxJourneys, current, relations, registry);

  const context = buildContext(delta.scripts, current, registry, input.profile);

  const anchors = registry.list();
  const notes: string[] = [];
  if (
    delta.scripts.some((script) => script.status === "removed") ||
    delta.tables.some((table) => table.status === "removed")
  ) {
    notes.push("Removed origins are listed without journeys (journeys walk the current side).");
  }
  if (anchors.length > maxAnchors) {
    notes.push(
      `Anchor count ${anchors.length} exceeds the budget ${maxAnchors}; none were dropped to preserve citation integrity.`,
    );
  }

  return {
    schemaVersion: DIGEST_SCHEMA_VERSION,
    refs: {
      base: { ref: input.base.ref, commitHash: input.base.commitHash },
      current: { ref: input.current.ref, commitHash: input.current.commitHash },
    },
    stats: {
      filesChanged: changeFacts.length,
      scriptFilesChanged: scriptFacts.length,
      tableFilesChanged: tableFacts.length,
      symbolsAdded: sumBy(scriptFacts, (script) => script.symbolsAdded.length),
      symbolsRemoved: sumBy(scriptFacts, (script) => script.symbolsRemoved.length),
      symbolsChanged: sumBy(scriptFacts, (script) => script.symbolsChanged.length),
      rowsAdded: sumBy(tableFacts, (table) => table.rowsAdded.length),
      rowsRemoved: sumBy(tableFacts, (table) => table.rowsRemoved.length),
      rowsChanged: sumBy(tableFacts, (table) => table.rowsChanged.length),
    },
    changeFacts,
    linked,
    context,
    anchors,
    manifest: {
      budgets: { maxJourneys, maxAnchors },
      counts: {
        changedScripts: scriptFacts.length,
        changedTables: tableFacts.length,
        anchors: anchors.length,
        journeys: linked.length,
        contextItems: context.length,
      },
      selection: {
        journeyCandidates: candidates.length,
        journeysSelected: linked.length,
        anchorsDropped: 0,
      },
      notes,
    },
  };
}

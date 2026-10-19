import type {
  Anchor,
  AnchorLoc,
  DigestBundle,
  DigestCellChange,
  DigestContextItem,
  DigestFinding,
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
} from "@silentskip/contracts";
import { type CheckSide, runChecks } from "../checks/index.js";
import { type CsvTable, delimiterForPath, parseCsv } from "../csv/index.js";
import {
  buildDeltaFromParsed,
  type CsvRowRef,
  type CsvTableDelta,
  type ScriptFileDelta,
} from "../delta/index.js";
import { buildFactBundle, type SourceInput, type SymbolKind } from "../facts/index.js";
import {
  buildJourney,
  buildSymbolIndex,
  type JourneyNode,
  type JourneyOrigin,
} from "../journey/index.js";
import {
  buildReadingPlan,
  type PlanInput,
  type PlanScriptInput,
  type PlanTableInput,
} from "../plan/index.js";
import { buildRelations, type RelationSet } from "../relations/index.js";
import { runSurfaces } from "../surfaces/index.js";
import { collectBodies } from "./bodies.js";
import { collectQuantities } from "./quantities.js";
import {
  AnchorRegistry,
  cellSpan,
  compareStrings,
  type DigestSide,
  rowSpan,
  SCRIPT_EXTENSION,
  sumBy,
  TABLE_EXTENSION,
  valueMap,
  widthSummary,
} from "./shared.js";
import {
  DEFAULT_BODY_BUDGET_BYTES,
  DEFAULT_MAX_ANCHORS,
  DEFAULT_MAX_JOURNEYS,
  DIGEST_SCHEMA_VERSION,
  type DigestInput,
} from "./types.js";

export { gitBlobSha } from "./shared.js";

/** One parsed side of the comparison: sources, facts and tables, all keyed by path. */
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
  for (const table of tables)
    tableMap.set(table.path, parseCsv(table.source, delimiterForPath(table.path)));
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
  const beforeValues = valueMap(base.factsByPath.get(delta.path));
  const afterValues = valueMap(current.factsByPath.get(delta.path));

  const symbolsAdded: DigestSymbolRef[] = [];
  const symbolsRemoved: DigestSymbolRef[] = [];
  const symbolsChanged: DigestSymbolChange[] = [];

  if (afterSource !== undefined) {
    for (const symbol of delta.symbolsAdded) {
      const value = afterValues.get(symbol.id);
      symbolsAdded.push({
        name: symbol.name,
        symbolKind: symbol.kind,
        anchorId: registry.add("B", delta.path, afterSource, symbol.nameSpan, "code"),
        ...(value === undefined ? {} : { value }),
      });
    }
  }
  if (beforeSource !== undefined) {
    for (const symbol of delta.symbolsRemoved) {
      const value = beforeValues.get(symbol.id);
      symbolsRemoved.push({
        name: symbol.name,
        symbolKind: symbol.kind,
        anchorId: registry.add("A", delta.path, beforeSource, symbol.nameSpan, "code"),
        ...(value === undefined ? {} : { value }),
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
      ...(change.beforeValue === undefined ? {} : { beforeValue: change.beforeValue }),
      ...(change.afterValue === undefined ? {} : { afterValue: change.afterValue }),
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
    columns: {
      before: beforeTable?.rows[0]?.cells.length ?? null,
      after: afterTable?.rows[0]?.cells.length ?? null,
    },
    widths: { before: widthSummary(beforeTable), after: widthSummary(afterTable) },
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
  const symbolIndex = buildSymbolIndex(current.bundle);
  for (const candidate of selectJourneyCandidates(candidates, maxJourneys)) {
    const journey = buildJourney({
      bundle: current.bundle,
      relations,
      origin: candidate.origin,
      maxDepth: 2,
      symbolIndex,
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

/** Narrows the digest side into the checks-layer view. */
function checkSideOf(side: DigestSide, ref: "A" | "B"): CheckSide {
  return { ref, sources: side.sources, factsByPath: side.factsByPath, tables: side.tables };
}

/** Maps digest change facts + import edges into the reading-plan input. */
function planInput(
  changeFacts: readonly (DigestScriptChange | DigestTableChange)[],
  relations: RelationSet,
  unitBudgetBytes: number | undefined,
): PlanInput {
  const scripts: PlanScriptInput[] = [];
  const tables: PlanTableInput[] = [];
  for (const fact of changeFacts) {
    if (fact.kind === "script") {
      scripts.push({
        path: fact.path,
        status: fact.status,
        language: fact.language,
        importsAdded: fact.importsAdded,
        importsRemoved: fact.importsRemoved,
        symbolsAdded: fact.symbolsAdded.map((symbol) => ({
          name: symbol.name,
          kind: symbol.symbolKind as SymbolKind,
          ...(symbol.value === undefined ? {} : { value: symbol.value }),
        })),
        symbolsRemoved: fact.symbolsRemoved.map((symbol) => ({
          name: symbol.name,
          kind: symbol.symbolKind as SymbolKind,
          ...(symbol.value === undefined ? {} : { value: symbol.value }),
        })),
        symbolsChanged: fact.symbolsChanged.map((change) => ({
          name: change.name,
          kind: change.symbolKind as SymbolKind,
          ...(change.beforeValue === undefined ? {} : { beforeValue: change.beforeValue }),
          ...(change.afterValue === undefined ? {} : { afterValue: change.afterValue }),
        })),
      });
      continue;
    }
    tables.push({
      path: fact.path,
      status: fact.status,
      headerChanged: fact.headerChanged,
      beforeColumns: fact.columns.before,
      afterColumns: fact.columns.after,
      rowsAdded: fact.rowsAdded.map((row) => row.key),
      rowsRemoved: fact.rowsRemoved.map((row) => row.key),
      rowsChanged: fact.rowsChanged.map((row) => ({
        key: row.key,
        cells: row.columnsChanged.map((cell) => ({
          column: typeof cell.column === "number" ? String(cell.column) : cell.column,
          before: cell.before,
          after: cell.after,
        })),
      })),
    });
  }
  const changedPaths = new Set(changeFacts.map((fact) => fact.path));
  const graphEdges = relations.relations
    .filter(
      (relation) =>
        relation.ruleId === "import-path-matches-file" &&
        changedPaths.has(relation.from.file) &&
        changedPaths.has(relation.to.file),
    )
    .map((relation) => ({ from: relation.from.file, to: relation.to.file }));
  return {
    scripts,
    tables,
    graphEdges,
    ...(unitBudgetBytes === undefined ? {} : { unitBudgetBytes }),
  };
}

export function buildDigest(input: DigestInput): DigestBundle {
  const maxJourneys = input.budgets?.maxJourneys ?? DEFAULT_MAX_JOURNEYS;
  const maxAnchors = input.budgets?.maxAnchors ?? DEFAULT_MAX_ANCHORS;

  const base = buildSide(input.base.sources);
  const current = buildSide(input.current.sources);
  const registry = new AnchorRegistry();

  const delta = buildDeltaFromParsed(
    { sources: base.sources, facts: base.factsByPath, tables: base.tables },
    { sources: current.sources, facts: current.factsByPath, tables: current.tables },
  );
  const relations = buildRelations(current.bundle, {
    csvPaths: [...current.tables.keys()],
    editorGenIndex: input.profile?.editorGenIndex === true,
  });

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

  const findings: DigestFinding[] = runChecks({
    base: checkSideOf(base, "A"),
    current: checkSideOf(current, "B"),
    delta,
    ...(input.profile === undefined ? {} : { profile: input.profile }),
    relations,
    registerAnchor: (ref, file, span, kind) => {
      const side = ref === "A" ? base : current;
      const source = side.sources.get(file);
      if (source === undefined) {
        throw new Error(`Check anchor source missing: ${ref}:${file}`);
      }
      return registry.add(ref, file, source, span, kind);
    },
  });
  const surfaces = runSurfaces({
    base: checkSideOf(base, "A"),
    current: checkSideOf(current, "B"),
    delta,
    ...(input.profile === undefined ? {} : { profile: input.profile }),
    relations,
    registerAnchor: (ref, file, span, kind) => {
      const side = ref === "A" ? base : current;
      const source = side.sources.get(file);
      if (source === undefined) {
        throw new Error(`Surface anchor source missing: ${ref}:${file}`);
      }
      return registry.add(ref, file, source, span, kind);
    },
  });
  const bodyBudget = input.budgets?.bodyBudgetBytes ?? DEFAULT_BODY_BUDGET_BYTES;
  const bodyMaterial = collectBodies(delta, current, bodyBudget);
  const quantities = collectQuantities(changeFacts, base, current, registry);
  const plan = buildReadingPlan(planInput(changeFacts, relations, input.budgets?.unitBudgetBytes));

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
  if (bodyMaterial.dropped > 0) {
    notes.push(
      `Body material: ${bodyMaterial.dropped} function body(ies) omitted beyond the ${bodyBudget}-byte budget.`,
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
    quantities,
    findings,
    surfaces,
    bodies: bodyMaterial.bodies,
    plan,
    anchors,
    manifest: {
      budgets: { maxJourneys, maxAnchors },
      counts: {
        changedScripts: scriptFacts.length,
        changedTables: tableFacts.length,
        anchors: anchors.length,
        journeys: linked.length,
        contextItems: context.length,
        bodies: bodyMaterial.bodies.length,
        bodiesTruncated: bodyMaterial.truncated + bodyMaterial.dropped,
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

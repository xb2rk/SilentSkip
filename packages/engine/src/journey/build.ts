/**
 * Value Journey builder — pure and deterministic.
 *
 * Expansion rules per node kind (v1):
 * - `csv-table` → the string literals that name the table (`string-names-csv`).
 * - `string-literal` → the innermost symbol containing it (its binding site).
 * - `symbol` → sites that reference or call it, plus its outgoing calls when it
 *   is a function/event (each callee resolved through its relation, or kept as
 *   `unknown` with an explicit note).
 * - `ref-site` / `call-site` → the innermost symbol containing the site (the
 *   runtime context).
 *
 * Chains never repeat a node; every list is sorted before use, and the chain
 * cap keeps the payload bounded with a truthful `truncated` flag.
 */

import type {
  CallFact,
  FactBundle,
  FactSpan,
  FileFacts,
  RefFact,
  SymbolFact,
} from "../facts/index.js";
import type { Relation } from "../relations/index.js";
import type {
  Journey,
  JourneyChain,
  JourneyInput,
  JourneyNode,
  JourneySymbolIndex,
} from "./types.js";
import { JOURNEY_SCHEMA_VERSION } from "./types.js";

/** Maximum chains reported; hitting it sets `truncated`. */
const MAX_CHAINS = 50;

/** Expands one journey from the given inputs. */
export function buildJourney(input: JourneyInput): Journey {
  const maxDepth = input.maxDepth ?? 2;
  const maxNodesPerLayer = input.maxNodesPerLayer ?? 24;
  const factsByFile = new Map(input.bundle.files.map((file) => [file.path, file]));
  const origin = buildOriginNode(input, factsByFile);
  const context: ExpandContext = {
    factsByFile,
    relations: input.relations.relations,
    symbolIndex: input.symbolIndex ?? buildSymbolIndex(input.bundle),
  };

  const childrenByParent = new Map<string, JourneyNode[]>();
  const kept = new Set<string>([origin.id]);
  let layer: JourneyNode[] = [origin];
  let truncated = false;

  for (let depth = 1; depth <= maxDepth; depth++) {
    const next: JourneyNode[] = [];
    for (const node of layer) {
      const children = expandNode(node, context).map((child) => ({ ...child, level: depth }));
      if (children.length > 0) childrenByParent.set(node.id, children);
      next.push(...children);
    }
    const deduped = dedupeAndSort(next);
    const keptLayer = deduped.slice(0, maxNodesPerLayer);
    if (keptLayer.length < deduped.length) truncated = true;
    for (const node of keptLayer) kept.add(node.id);
    layer = keptLayer;
  }

  // Prune edges pointing at dropped nodes so chains never reference a missing one.
  for (const [parentId, children] of [...childrenByParent.entries()]) {
    const keptChildren = dedupeAndSort(children.filter((child) => kept.has(child.id)));
    if (keptChildren.length === 0) childrenByParent.delete(parentId);
    else childrenByParent.set(parentId, keptChildren);
  }

  const chains: JourneyChain[] = [];
  const visit = (path: readonly JourneyNode[]): void => {
    if (chains.length >= MAX_CHAINS) {
      truncated = true;
      return;
    }
    const current = path[path.length - 1];
    if (current === undefined) return;
    const children = (childrenByParent.get(current.id) ?? []).filter(
      (child) => !path.some((node) => node.id === child.id),
    );
    if (children.length === 0) {
      // Origin-only paths are not journeys; they are the dead-value case.
      if (path.length > 1) chains.push({ nodes: path });
      return;
    }
    for (const child of children) visit([...path, child]);
  };
  visit([origin]);

  const journey: Journey = {
    schemaVersion: JOURNEY_SCHEMA_VERSION,
    origin,
    chains,
    truncated,
    ...(chains.length === 0 ? { note: deadValueNote(input.origin) } : {}),
  };
  return journey;
}

/** Shared read-only context for expansion. */
interface ExpandContext {
  readonly factsByFile: Map<string, FileFacts>;
  readonly relations: readonly Relation[];
  readonly symbolIndex: JourneySymbolIndex;
}

/** Builds the level-0 node for the requested origin. */
function buildOriginNode(input: JourneyInput, factsByFile: Map<string, FileFacts>): JourneyNode {
  const origin = input.origin;
  if (origin.kind === "csv") {
    const label = origin.rowKey === undefined ? origin.path : `${origin.path}#${origin.rowKey}`;
    return {
      id: `csv-table|${origin.path}|-1|${origin.rowKey ?? ""}`,
      level: 0,
      kind: "csv-table",
      file: origin.path,
      label,
      confidence: "origin",
      derivation:
        origin.rowKey === undefined
          ? [`Changed config table ${origin.path}`]
          : [`Changed row ${origin.rowKey} in ${origin.path}`],
    };
  }
  const file = factsByFile.get(origin.file);
  const symbol = file?.symbols.find((candidate) => candidate.id === origin.symbolId);
  if (symbol === undefined) {
    throw new Error(`Unknown journey origin symbol: ${origin.symbolId}`);
  }
  return {
    id: `symbol|${origin.file}|${symbol.nameSpan.offset}|${symbol.id}`,
    level: 0,
    kind: "symbol",
    file: origin.file,
    span: symbol.nameSpan,
    label: symbol.name,
    symbolId: symbol.id,
    confidence: "origin",
    derivation: [`Changed ${symbol.kind} ${symbol.name}`],
  };
}

/** Expands one node into its next-layer children. */
function expandNode(node: JourneyNode, context: ExpandContext): JourneyNode[] {
  switch (node.kind) {
    case "csv-table":
      return expandCsvTable(node, context);
    case "string-literal":
      return expandStringLiteral(node, context);
    case "symbol":
      return expandSymbol(node, context);
    case "ref-site":
    case "call-site":
      return expandSite(node, context);
  }
}

/** `csv-table` → string literals naming the table. */
function expandCsvTable(node: JourneyNode, context: ExpandContext): JourneyNode[] {
  const target = normalizePath(node.file);
  const matches = context.relations.filter(
    (relation) =>
      relation.ruleId === "string-names-csv" && normalizePath(relation.to.file) === target,
  );
  return matches.map((relation) => {
    const literal = findStringFact(context, relation.from.file, relation.from.span?.offset);
    return makeNode({
      kind: "string-literal",
      file: relation.from.file,
      ...(relation.from.span === undefined ? {} : { span: relation.from.span }),
      label: literal?.rawText ?? relation.to.file,
      confidence: relation.confidence,
      derivation: relation.derivation,
    });
  });
}

/** `string-literal` → the innermost symbol containing it. */
function expandStringLiteral(node: JourneyNode, context: ExpandContext): JourneyNode[] {
  const file = context.factsByFile.get(node.file);
  if (file === undefined || node.span === undefined) return [];
  const container = innermostSymbol(file.symbols, node.span);
  if (container === undefined) return [];
  return [
    makeNode({
      kind: "symbol",
      file: node.file,
      span: container.nameSpan,
      label: container.name,
      symbolId: container.id,
      confidence: "exact",
      derivation: [`Literal contained in ${container.kind} ${container.name}`],
    }),
  ];
}

/** `symbol` → use-sites, plus outgoing calls for function/event symbols. */
function expandSymbol(node: JourneyNode, context: ExpandContext): JourneyNode[] {
  const symbolId = node.symbolId;
  if (symbolId === undefined) return [];
  const nodes: JourneyNode[] = [];

  const useSites = context.relations.filter((relation) => {
    if (relation.to.symbolId !== symbolId) return false;
    if (relation.ruleId === "call-name-resolves") return true;
    if (relation.ruleId !== "name-refers-to-symbol") return false;
    // A callee name is also recorded as a ref; the call-site representation is
    // richer, so skip the ref-site twin at the same position.
    const offset = relation.from.span?.offset;
    return !context.relations.some(
      (candidate) =>
        candidate.ruleId === "call-name-resolves" &&
        candidate.from.file === relation.from.file &&
        candidate.from.span?.offset === offset,
    );
  });
  for (const relation of useSites) {
    const isCall = relation.ruleId === "call-name-resolves";
    let label = node.label;
    if (isCall) {
      const call = findCallFact(context, relation.from.file, relation.from.span?.offset);
      if (call !== undefined) label = call.calleeText;
    } else {
      const ref = findRefFact(context, relation.from.file, relation.from.span?.offset);
      if (ref !== undefined) label = ref.name;
    }
    nodes.push(
      makeNode({
        kind: isCall ? "call-site" : "ref-site",
        file: relation.from.file,
        ...(relation.from.span === undefined ? {} : { span: relation.from.span }),
        label,
        confidence: relation.confidence,
        derivation: relation.derivation,
      }),
    );
  }

  const entry = context.symbolIndex.get(symbolId);
  if (entry !== undefined && (entry.symbol.kind === "function" || entry.symbol.kind === "event")) {
    const symbol = entry.symbol;
    const file = context.factsByFile.get(entry.file);
    for (const call of file?.calls ?? []) {
      if (call.container !== symbol.name) continue;
      const relation = context.relations.find(
        (candidate) =>
          candidate.from.file === entry.file &&
          candidate.from.span?.offset === call.span.offset &&
          (candidate.ruleId === "call-name-resolves" ||
            candidate.ruleId === "call-receiver-import"),
      );
      nodes.push(
        makeNode({
          kind: "call-site",
          file: entry.file,
          span: call.span,
          label: call.calleeText,
          confidence: relation?.confidence ?? "unknown",
          derivation: relation?.derivation ?? [
            "Call site recorded; callee unresolved — no relation",
          ],
        }),
      );
    }
  }
  return nodes;
}

/** `ref-site` / `call-site` → the innermost symbol containing the site. */
function expandSite(node: JourneyNode, context: ExpandContext): JourneyNode[] {
  const file = context.factsByFile.get(node.file);
  const span = node.span;
  if (file === undefined || span === undefined) return [];
  const fact =
    node.kind === "call-site"
      ? findCallFact(context, node.file, span.offset)
      : findRefFact(context, node.file, span.offset);
  const candidates = file.symbols.filter(
    (symbol) =>
      symbol.span.offset <= span.offset &&
      span.offset + span.length <= symbol.span.offset + symbol.span.length,
  );
  const named =
    fact?.container === undefined
      ? candidates
      : candidates.filter((symbol) => symbol.name === fact.container);
  const container = innermostSymbol(named.length > 0 ? named : candidates, span);
  if (container === undefined) return [];
  return [
    makeNode({
      kind: "symbol",
      file: node.file,
      span: container.nameSpan,
      label: container.name,
      symbolId: container.id,
      confidence: "exact",
      derivation: [`Site inside ${container.kind} ${container.name}`],
    }),
  ];
}

/** Builds a node with a deterministic id and the given level filled by the caller. */
function makeNode(fields: Omit<JourneyNode, "id" | "level">): JourneyNode {
  const offset = fields.span?.offset ?? -1;
  const key = fields.symbolId ?? fields.label;
  return {
    id: `${fields.kind}|${fields.file}|${offset}|${key}`,
    level: 0,
    ...fields,
  };
}

/** Indexes every symbol of the bundle by id. */
export function buildSymbolIndex(bundle: FactBundle): JourneySymbolIndex {
  const index = new Map<string, { file: string; symbol: SymbolFact }>();
  for (const file of bundle.files) {
    for (const symbol of file.symbols) {
      index.set(symbol.id, { file: file.path, symbol });
    }
  }
  return index;
}

/** Finds the innermost (smallest span) symbol containing the target span. */
function innermostSymbol(symbols: readonly SymbolFact[], target: FactSpan): SymbolFact | undefined {
  let best: SymbolFact | undefined;
  for (const symbol of symbols) {
    const contains =
      symbol.span.offset <= target.offset &&
      target.offset + target.length <= symbol.span.offset + symbol.span.length;
    if (!contains) continue;
    if (
      best === undefined ||
      symbol.span.length < best.span.length ||
      (symbol.span.length === best.span.length && symbol.span.offset < best.span.offset)
    ) {
      best = symbol;
    }
  }
  return best;
}

/** Looks up a string fact by file and span offset. */
function findStringFact(
  context: ExpandContext,
  file: string,
  offset: number | undefined,
): { rawText: string } | undefined {
  if (offset === undefined) return undefined;
  return context.factsByFile.get(file)?.strings.find((string) => string.span.offset === offset);
}

/** Looks up a ref fact by file and span offset. */
function findRefFact(
  context: ExpandContext,
  file: string,
  offset: number | undefined,
): RefFact | undefined {
  if (offset === undefined) return undefined;
  return context.factsByFile.get(file)?.refs.find((ref) => ref.span.offset === offset);
}

/** Looks up a call fact by file and span offset. */
function findCallFact(
  context: ExpandContext,
  file: string,
  offset: number | undefined,
): CallFact | undefined {
  if (offset === undefined) return undefined;
  return context.factsByFile.get(file)?.calls.find((call) => call.span.offset === offset);
}

/** Dedupes by node id and sorts by file, offset, then id. */
function dedupeAndSort(nodes: readonly JourneyNode[]): JourneyNode[] {
  const byId = new Map<string, JourneyNode>();
  for (const node of nodes) {
    if (!byId.has(node.id)) byId.set(node.id, node);
  }
  return [...byId.values()].sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    const offsetA = a.span?.offset ?? -1;
    const offsetB = b.span?.offset ?? -1;
    if (offsetA !== offsetB) return offsetA - offsetB;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Normalizes a path for CSV comparisons: forward slashes, lowercase. */
function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").toLowerCase();
}

/** The honest dead-value message. */
function deadValueNote(origin: JourneyInput["origin"]): string {
  if (origin.kind === "csv") {
    return `No code path found for ${origin.path} — no string literal names it. Consider pinning a binding.`;
  }
  return "No use-sites found — the symbol may be unused or name resolution is incomplete.";
}

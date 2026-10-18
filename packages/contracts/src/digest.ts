import { z } from "zod";

import { SilentSkipSurfaceSchema } from "./surface";

/**
 * Anchor + digest contracts — the JSON shapes of the fact sheet that is served to the UI
 * and, from E4, to the AI passes. Schemas are the source of truth; the server and the web
 * app parse at their boundaries.
 *
 * Anchor ids are content-stable (`ref:file:lines:kind[:loc]`) so pins and citations survive
 * re-runs of the engine. Every anchor carries a `blobSha` (git blob hash of the file content
 * it was taken from) and a `snippet` that must equal the exact source slice at those lines.
 */

/** Which side of the A/B comparison an anchor points at. */
export const AnchorRefSchema = z.enum(["A", "B"]);

/** Cell coordinates inside a CSV anchor: row key (PK value) and column name or index. */
export const AnchorLocSchema = z.object({
  rowKey: z.string().optional(),
  column: z.union([z.string(), z.number()]).optional(),
});

/** A verifiable pointer into a source file: stable id, git blob, lines, exact snippet. */
export const AnchorSchema = z.object({
  id: z.string(),
  ref: AnchorRefSchema,
  file: z.string(),
  blobSha: z.string(),
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  snippet: z.string(),
  loc: AnchorLocSchema.optional(),
  kind: z.enum(["csv", "code", "contract", "diff"]),
});

/** One side of the comparison as recorded in the digest. */
export const DigestRefSideSchema = z.object({
  ref: z.string(),
  commitHash: z.string().nullable(),
});

/** A symbol recorded on one side of the comparison, pointing at its name span anchor. */
export const DigestSymbolRefSchema = z.object({
  name: z.string(),
  symbolKind: z.string(),
  anchorId: z.string(),
  /** Raw literal initializer text when the declaration initializes from a single literal. */
  value: z.string().optional(),
});

/** A symbol whose content hash differs between A and B, with one anchor per side. */
export const DigestSymbolChangeSchema = z.object({
  name: z.string(),
  symbolKind: z.string(),
  beforeAnchorId: z.string(),
  afterAnchorId: z.string(),
  /** Raw literal initializer text on side A, when one exists. */
  beforeValue: z.string().optional(),
  /** Raw literal initializer text on side B, when one exists. */
  afterValue: z.string().optional(),
});

/** Layer 1 — a changed script file and its symbol/import deltas. */
export const DigestScriptChangeSchema = z.object({
  kind: z.literal("script"),
  path: z.string(),
  status: z.enum(["added", "removed", "changed"]),
  language: z.enum(["fcc", "fcg"]),
  symbolsAdded: z.array(DigestSymbolRefSchema),
  symbolsRemoved: z.array(DigestSymbolRefSchema),
  symbolsChanged: z.array(DigestSymbolChangeSchema),
  importsAdded: z.array(z.string()),
  importsRemoved: z.array(z.string()),
});

/** A CSV row recorded on one side of the comparison. */
export const DigestRowRefSchema = z.object({
  key: z.string(),
  keyKind: z.enum(["first-column", "row-index"]),
  line: z.number().int().positive(),
  text: z.string(),
  anchorId: z.string(),
});

/** One changed cell with raw values and anchors on both sides. */
export const DigestCellChangeSchema = z.object({
  column: z.union([z.string(), z.number()]),
  before: z.string(),
  after: z.string(),
  beforeAnchorId: z.string(),
  afterAnchorId: z.string(),
});

/** A CSV row whose cells changed between A and B. */
export const DigestRowChangeSchema = z.object({
  key: z.string(),
  keyKind: z.enum(["first-column", "row-index"]),
  columnsChanged: z.array(DigestCellChangeSchema),
  beforeLine: z.number().int().positive(),
  afterLine: z.number().int().positive(),
});

/** Distinct row width and how many data rows have it (raw structure, nothing inferred). */
export const DigestWidthEntrySchema = z.object({
  width: z.number().int().positive(),
  rows: z.number().int().nonnegative(),
});

/** Layer 1 — a changed CSV table and its row deltas. */
export const DigestTableChangeSchema = z.object({
  kind: z.literal("table"),
  path: z.string(),
  status: z.enum(["added", "removed", "changed"]),
  headerChanged: z.boolean(),
  /** Header cell count per side; null when the table does not exist on that side. */
  columns: z.object({
    before: z.number().int().positive().nullable(),
    after: z.number().int().positive().nullable(),
  }),
  /** Distinct data-row widths per side — the raw material of the STRUCT checks. */
  widths: z.object({
    before: z.array(DigestWidthEntrySchema),
    after: z.array(DigestWidthEntrySchema),
  }),
  rowsAdded: z.array(DigestRowRefSchema),
  rowsRemoved: z.array(DigestRowRefSchema),
  rowsChanged: z.array(DigestRowChangeSchema),
});

/** Layer 1 — everything that changed, in exact facts with anchors. */
export const DigestChangeFactSchema = z.discriminatedUnion("kind", [
  DigestScriptChangeSchema,
  DigestTableChangeSchema,
]);

/**
 * A named quantity the AI must cite through its id instead of writing raw digits
 * (fact-id store, decision #28) — every number in a report resolves to one of these.
 */
export const DigestQuantitySchema = z.object({
  id: z.string(),
  kind: z.enum(["column-count", "row-count", "symbol-count", "value"]),
  subject: z.string(),
  value: z.string(),
  ref: AnchorRefSchema.nullable(),
  anchorId: z.string().nullable(),
  /** Changed file this quantity belongs to — lets passes attach facts per reading unit. */
  file: z.string().min(1),
});

/** Layer 3 — a deterministic engine finding: full-scope, fact-derived, never sampled. */
export const DigestFindingSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  severity: z.enum(["critical", "major", "minor", "info"]),
  confidence: z.enum(["exact", "inferred"]),
  title: z.string(),
  message: z.string(),
  anchors: z.array(z.string()),
  derivation: z.array(z.string()),
});

/** One node of a journey chain, resolved to an anchor. */
export const DigestJourneyNodeSchema = z.object({
  label: z.string(),
  nodeKind: z.string(),
  confidence: z.enum(["exact", "inferred", "unknown"]),
  anchorId: z.string(),
});

/** One ordered journey chain. */
export const DigestJourneyChainSchema = z.object({
  nodes: z.array(DigestJourneyNodeSchema),
});

/** Layer 2 — a changed origin (row/table/symbol) and the journeys that walk it. */
export const DigestLinkedSchema = z.object({
  originKind: z.enum(["csv-table", "csv-row", "symbol"]),
  originLabel: z.string(),
  anchorId: z.string().nullable(),
  chains: z.array(DigestJourneyChainSchema),
  note: z.string().optional(),
});

/** Layer 4 — supporting material: doc comments, pinned conventions, notes. */
export const DigestContextItemSchema = z.object({
  itemKind: z.enum(["doc-comment", "convention", "note"]),
  text: z.string(),
  source: z.string(),
  anchorId: z.string().nullable(),
});

/**
 * One function body shipped as reading material (E7.5): added/changed code the AI can ground
 * behavioral statements on. Exact source slice — truncated only with the `truncated` flag set.
 */
export const DigestBodySchema = z.object({
  file: z.string(),
  symbolId: z.string(),
  name: z.string(),
  kind: z.string(),
  side: AnchorRefSchema,
  lineStart: z.number().int().positive(),
  lineEnd: z.number().int().positive(),
  truncated: z.boolean(),
  text: z.string(),
});

/** Honest accounting of the span selection: budgets, counts and what was dropped. */
export const DigestManifestSchema = z.object({
  budgets: z.object({
    maxJourneys: z.number().int().positive(),
    maxAnchors: z.number().int().positive(),
  }),
  counts: z.object({
    changedScripts: z.number().int().nonnegative(),
    changedTables: z.number().int().nonnegative(),
    anchors: z.number().int().nonnegative(),
    journeys: z.number().int().nonnegative(),
    contextItems: z.number().int().nonnegative(),
    /** Function bodies shipped as reading material (E7.5). */
    bodies: z.number().int().nonnegative(),
    /** Bodies truncated per-function or omitted beyond the body budget. */
    bodiesTruncated: z.number().int().nonnegative(),
  }),
  selection: z.object({
    journeyCandidates: z.number().int().nonnegative(),
    journeysSelected: z.number().int().nonnegative(),
    anchorsDropped: z.number().int().nonnegative(),
  }),
  notes: z.array(z.string()),
});

/** Headline numbers for the digest, all computed by the engine — never by the AI. */
export const DigestStatsSchema = z.object({
  filesChanged: z.number().int().nonnegative(),
  scriptFilesChanged: z.number().int().nonnegative(),
  tableFilesChanged: z.number().int().nonnegative(),
  symbolsAdded: z.number().int().nonnegative(),
  symbolsRemoved: z.number().int().nonnegative(),
  symbolsChanged: z.number().int().nonnegative(),
  rowsAdded: z.number().int().nonnegative(),
  rowsRemoved: z.number().int().nonnegative(),
  rowsChanged: z.number().int().nonnegative(),
});

/** One reading unit of the change set: the files it covers plus its compacted payload. */
export const DigestUnitSchema = z.object({
  index: z.number().int().nonnegative(),
  files: z.array(z.string()),
  estimatedBytes: z.number().int().nonnegative(),
  payload: z.string(),
});

/** Per-file skeleton entry — the whole change map without payloads. */
export const DigestSkeletonFileSchema = z.object({
  path: z.string(),
  kind: z.enum(["script", "table"]),
  status: z.enum(["added", "removed", "changed"]),
  language: z.enum(["fcc", "fcg"]).optional(),
  counts: z.object({
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
  }),
  changedSymbols: z.array(z.string()),
  headerColumns: z.number().int().positive().nullable(),
});

/** Directed import edge between two changed files. */
export const DigestSkeletonEdgeSchema = z.object({ from: z.string(), to: z.string() });

/** The change map: every changed file plus import edges among them. */
export const DigestSkeletonSchema = z.object({
  files: z.array(DigestSkeletonFileSchema),
  importEdges: z.array(DigestSkeletonEdgeSchema),
});

/** One deterministic cluster of changed files (base partition; the AI may only refine). */
export const DigestClusterSchema = z.object({ id: z.string(), files: z.array(z.string()) });

/** Base partition of the change set (import graph + filesystem grouping). */
export const DigestPartitionSchema = z.object({ clusters: z.array(DigestClusterSchema) });

/** Reading plan: budget-packed units, the skeleton and the base partition. */
export const DigestPlanSchema = z.object({
  units: z.array(DigestUnitSchema),
  skeleton: DigestSkeletonSchema,
  partition: DigestPartitionSchema,
});

/** The complete fact sheet for one A/B comparison. Deterministic: no timestamps inside. */
export const DigestBundleSchema = z.object({
  schemaVersion: z.number().int().positive(),
  refs: z.object({ base: DigestRefSideSchema, current: DigestRefSideSchema }),
  stats: DigestStatsSchema,
  changeFacts: z.array(DigestChangeFactSchema),
  linked: z.array(DigestLinkedSchema),
  context: z.array(DigestContextItemSchema),
  /** Named quantities (fact-id store) — the only legitimate source of numbers for the AI. */
  quantities: z.array(DigestQuantitySchema),
  /** Deterministic engine findings (layer 3). */
  findings: z.array(DigestFindingSchema),
  /** Silent-skip surface per ref plus the A/B delta (E8). */
  surfaces: SilentSkipSurfaceSchema,
  /** Body material: function bodies of added/changed functions (E7.5 reading depth). */
  bodies: z.array(DigestBodySchema),
  /** Reading plan: units + skeleton + base partition (E7 flow). */
  plan: DigestPlanSchema,
  anchors: z.array(AnchorSchema),
  manifest: DigestManifestSchema,
});

export type AnchorRef = z.infer<typeof AnchorRefSchema>;
export type AnchorLoc = z.infer<typeof AnchorLocSchema>;
export type Anchor = z.infer<typeof AnchorSchema>;
export type DigestRefSide = z.infer<typeof DigestRefSideSchema>;
export type DigestSymbolRef = z.infer<typeof DigestSymbolRefSchema>;
export type DigestSymbolChange = z.infer<typeof DigestSymbolChangeSchema>;
export type DigestScriptChange = z.infer<typeof DigestScriptChangeSchema>;
export type DigestRowRef = z.infer<typeof DigestRowRefSchema>;
export type DigestCellChange = z.infer<typeof DigestCellChangeSchema>;
export type DigestRowChange = z.infer<typeof DigestRowChangeSchema>;
export type DigestWidthEntry = z.infer<typeof DigestWidthEntrySchema>;
export type DigestTableChange = z.infer<typeof DigestTableChangeSchema>;
export type DigestChangeFact = z.infer<typeof DigestChangeFactSchema>;
export type DigestQuantity = z.infer<typeof DigestQuantitySchema>;
export type DigestFinding = z.infer<typeof DigestFindingSchema>;
export type DigestBody = z.infer<typeof DigestBodySchema>;
export type DigestUnit = z.infer<typeof DigestUnitSchema>;
export type DigestSkeletonFile = z.infer<typeof DigestSkeletonFileSchema>;
export type DigestSkeletonEdge = z.infer<typeof DigestSkeletonEdgeSchema>;
export type DigestSkeleton = z.infer<typeof DigestSkeletonSchema>;
export type DigestCluster = z.infer<typeof DigestClusterSchema>;
export type DigestPartition = z.infer<typeof DigestPartitionSchema>;
export type DigestPlan = z.infer<typeof DigestPlanSchema>;
export type DigestJourneyNode = z.infer<typeof DigestJourneyNodeSchema>;
export type DigestJourneyChain = z.infer<typeof DigestJourneyChainSchema>;
export type DigestLinked = z.infer<typeof DigestLinkedSchema>;
export type DigestContextItem = z.infer<typeof DigestContextItemSchema>;
export type DigestManifest = z.infer<typeof DigestManifestSchema>;
export type DigestStats = z.infer<typeof DigestStatsSchema>;
export type DigestBundle = z.infer<typeof DigestBundleSchema>;

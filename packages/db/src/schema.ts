import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Craftland QA database schema (SQLite via node:sqlite).
 *
 * Design notes:
 * - JSON payloads (reports, digests, manifests, ledgers) live in `*_json` text columns;
 *   their shapes are owned by `@craftland-qa/contracts`, not by this schema.
 * - Enum-ish columns carry `$type<>()` unions so app code works with string unions while
 *   SQLite stores plain text (no CHECK constraints — invalid states are rejected at the
 *   contract (Zod) boundary, this schema is the persistence mirror).
 * - Domain enums never rely on numeric ordinals (rename/reorder safety).
 * - `databases/timestamps` are epoch milliseconds (`timestamp_ms`) everywhere.
 */

/** Lifecycle status of an analysis run. */
export type RunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

/** Designer-facing verdict of a completed run. */
export type Verdict =
  | "pass"
  | "pass_with_warnings"
  | "needs_review"
  | "fail"
  | "insufficient_evidence";

/** Finding severity scale. */
export type Severity = "critical" | "major" | "minor" | "info";

/** How confident the engine is in a relation or finding. */
export type Confidence = "exact" | "inferred" | "unknown";

/** What the game runtime actually does with a value/row (silent-skip surface). */
export type RuntimeEffect =
  | "skipped"
  | "defaulted"
  | "wrong_column"
  | "disabled"
  | "fallback"
  | "none";

/** Whether the value is actually read anywhere (config-auditor taxonomy). */
export type RuntimeUse =
  | "used"
  | "used_with_fallback"
  | "presentation_only"
  | "currently_ignored"
  | "unknown";

/** Change classification: value-only edit vs contract (boundary) change. */
export type ChangeClass = "value_only" | "contract";

/** Developer verification workflow state for a finding. */
export type VerifyState = "new" | "confirmed" | "false_positive" | "wontfix";

/** Registered projects (roots allowed for analysis). */
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  rootPath: text("root_path").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  lastIndexedAt: integer("last_indexed_at", { mode: "timestamp_ms" }),
});

/**
 * Per-project learned conventions (Project Profile). Everything that differs between
 * Craftland projects — read APIs, CSV link channels, binding styles, pins — lives here
 * as data; engine code never hardcodes project-specific knowledge.
 */
export const projectProfiles = sqliteTable("project_profiles", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  conventionsJson: text("conventions_json"),
  readApiFamilyJson: text("read_api_family_json"),
  overridesJson: text("overrides_json"),
  coverageJson: text("coverage_json"),
  editorGenIndex: integer("editor_gen_index", { mode: "boolean" }).notNull().default(false),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** Resolved git refs per project (cache of `git rev-parse`). */
export const refs = sqliteTable(
  "refs",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    commitHash: text("commit_hash").notNull(),
    treeHash: text("tree_hash"),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.name] })],
);

/** Persisted syntax-graph/fact snapshots keyed by git blob identity (cache). */
export const indexSnapshots = sqliteTable(
  "index_snapshots",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ref: text("ref").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    jsonBlob: text("json_blob").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("index_snapshots_project_ref_idx").on(t.projectId, t.ref)],
);

/** Cached Value Journeys (propagation chains) keyed by origin entity + ref. */
export const valueJourneys = sqliteTable(
  "value_journeys",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    ref: text("ref").notNull(),
    originKey: text("origin_key").notNull(),
    jsonBlob: text("json_blob").notNull(),
    builtAt: integer("built_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("value_journeys_project_ref_idx").on(t.projectId, t.ref, t.originKey)],
);

/** Analysis runs: one A/B review execution. */
export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    baseRef: text("base_ref").notNull(),
    currentRef: text("current_ref").notNull(),
    goal: text("goal"),
    lens: text("lens"),
    status: text("status").$type<RunStatus>().notNull(),
    verdict: text("verdict").$type<Verdict>(),
    qualityScore: integer("quality_score"),
    reportJson: text("report_json"),
    diffSummaryJson: text("diff_summary_json"),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("runs_project_created_idx").on(t.projectId, t.createdAt)],
);

/** Silent-skip surfaces computed per ref for a run. */
export const surfaces = sqliteTable(
  "surfaces",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    ref: text("ref").notNull(),
    jsonBlob: text("json_blob").notNull(),
  },
  (t) => [index("surfaces_run_idx").on(t.runId)],
);

/** A/B delta of the silent-skip surface (new / fixed / unchanged). */
export const surfaceDeltas = sqliteTable("surface_deltas", {
  runId: text("run_id")
    .primaryKey()
    .references(() => runs.id, { onDelete: "cascade" }),
  jsonBlob: text("json_blob").notNull(),
});

/** Findings emitted by engine checks and verified AI claims. */
export const findings = sqliteTable(
  "findings",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    checkId: text("check_id").notNull(),
    severity: text("severity").$type<Severity>().notNull(),
    runtimeEffect: text("runtime_effect").$type<RuntimeEffect>().notNull(),
    runtimeUse: text("runtime_use").$type<RuntimeUse>().notNull(),
    changeClass: text("change_class").$type<ChangeClass>().notNull(),
    approvalRequired: integer("approval_required", { mode: "boolean" }).notNull().default(false),
    confidence: text("confidence").$type<Confidence>().notNull(),
    titleKey: text("title_key").notNull(),
    messageArgsJson: text("message_args_json").notNull(),
    anchorsJson: text("anchors_json").notNull(),
    consequence: text("consequence"),
    journeyJson: text("journey_json"),
    verifyState: text("verify_state").$type<VerifyState>().notNull().default("new"),
    verifyNote: text("verify_note"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("findings_run_idx").on(t.runId)],
);

/** What-If chat sessions. */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    runId: text("run_id"),
    title: text("title").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("sessions_project_idx").on(t.projectId)],
);

/** Individual turns of a What-If session. */
export const turns = sqliteTable(
  "turns",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    turnIndex: integer("turn_index").notNull(),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    anchorsJson: text("anchors_json"),
    pinsJson: text("pins_json"),
    contextManifestId: text("context_manifest_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("turns_session_idx").on(t.sessionId, t.turnIndex)],
);

/**
 * Structured session state (established claims, open questions, speculations, pins).
 * This is what makes multi-turn possible on a stateless AI backend: every new call is
 * reconstructed from turn history + this ledger instead of replaying raw chat logs.
 */
export const sessionLedgers = sqliteTable("session_ledgers", {
  sessionId: text("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  uptoTurn: integer("upto_turn").notNull(),
  ledgerJson: text("ledger_json").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** Pinned semantic knowledge (entity notes) with provenance + staleness tracking. */
export const semanticNotes = sqliteTable(
  "semantic_notes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    entityKey: text("entity_key").notNull(),
    note: text("note").notNull(),
    provenance: text("provenance").notNull(),
    pinnedBy: text("pinned_by"),
    sourceBlobShasJson: text("source_blob_shas_json"),
    staleAt: integer("stale_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("semantic_notes_entity_idx").on(t.projectId, t.entityKey)],
);

/** Audit log of every AI context assembly + call result statistics. */
export const contextManifests = sqliteTable("context_manifests", {
  id: text("id").primaryKey(),
  runId: text("run_id"),
  turnId: text("turn_id"),
  promptVersion: text("prompt_version").notNull(),
  passId: text("pass_id").notNull(),
  sectionsJson: text("sections_json").notNull(),
  totalBytes: integer("total_bytes").notNull(),
  aiCallJson: text("ai_call_json"),
  verifiedStatsJson: text("verified_stats_json"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Eval cases: injected defects (expect found) and clean corpora (expect no findings). */
export const evalCases = sqliteTable("eval_cases", {
  id: text("id").primaryKey(),
  projectId: text("project_id"),
  kind: text("kind").$type<"injected" | "real" | "clean">().notNull(),
  description: text("description").notNull(),
  expectJson: text("expect_json").notNull(),
  lastResultJson: text("last_result_json"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

/** Simple key/value application settings (AI budgets, editorGen toggle, etc.). */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

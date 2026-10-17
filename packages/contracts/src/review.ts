import { z } from "zod";
import { ReviewLensSchema, SynthesizeOutputSchema, VerdictSchema } from "./passes";

/**
 * Review-run contracts (E4.4) — the wire shape of an A/B review execution over HTTP.
 *
 * These are server-side mirrors of the AI package's runtime types (`PassMeta`, `VerifyStats`,
 * `VerifyIssue`, the context manifest): contracts own the wire format, `packages/ai` owns
 * behavior. When a mirror drifts, the server fails fast at the parse boundary instead of
 * shipping a lying payload.
 */

/** Lifecycle of a review run (mirrors the `runs.status` column). */
export const ReviewRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

/** Salvage rung of one AI call, as reported by the client — always surfaced, never hidden. */
export const SalvageLadderSchema = z.enum([
  "clean",
  "stripped",
  "fence",
  "braces",
  "text-fallback",
]);

/** Start a review run for an A/B range of a registered project. */
export const StartReviewRequestSchema = z.object({
  projectId: z.string().trim().min(1),
  /** Base ref (A) — must be a real ref; `WORKTREE` is rejected by the server. */
  baseRef: z.string().trim().min(1),
  /** Current ref (B) — `WORKTREE` is allowed. */
  currentRef: z.string().trim().min(1),
  goal: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((value) => (value === undefined || value === "" ? undefined : value)),
  lens: ReviewLensSchema.optional(),
});

/** Response of starting a run — the id to watch and stream. */
export const StartReviewResponseSchema = z.object({
  runId: z.string().min(1),
});

/** Per-pass metadata persisted with the run (prompt version + latency + salvage rung). */
export const ReviewPassMetaSchema = z.object({
  pass: z.enum(["digest_read", "dig", "synthesize"]),
  promptVersion: z.string().min(1),
  latencyMs: z.number().int().min(0),
  salvage: SalvageLadderSchema,
});

/** One verifier issue about a stripped or downgraded claim. */
export const VerifyIssueSchema = z.object({
  kind: z.enum([
    "unknown-anchor",
    "new-anchor",
    "finding-unanchored",
    "number-unverified",
    "quote-unverified",
    "verdict-downgraded",
  ]),
  pass: z.enum(["digest_read", "dig", "synthesize"]),
  target: z.string(),
  detail: z.string(),
});

/** Verifier counters of one pass — every check and every strip is counted. */
export const VerifyStatsSchema = z.object({
  findingsChecked: z.number().int().min(0),
  findingsStripped: z.number().int().min(0),
  anchorsChecked: z.number().int().min(0),
  anchorsStripped: z.number().int().min(0),
  numbersChecked: z.number().int().min(0),
  numbersUnverified: z.number().int().min(0),
  quotesChecked: z.number().int().min(0),
  quotesUnverified: z.number().int().min(0),
  confidenceDowngraded: z.number().int().min(0),
});

/** What was actually sent to the model (counts) plus honest budget notes. */
export const ReviewContextManifestSchema = z.object({
  counts: z.object({
    changeFacts: z.number().int().min(0),
    linked: z.number().int().min(0),
    contextItems: z.number().int().min(0),
    evidence: z.number().int().min(0),
    evidenceDropped: z.number().int().min(0),
  }),
  notes: z.array(z.string()),
});

/** Full persisted result of one run — everything the report UI needs (E5). */
export const ReviewRunResultSchema = z.object({
  report: SynthesizeOutputSchema,
  passes: z.array(ReviewPassMetaSchema),
  verification: z.object({
    read: VerifyStatsSchema,
    dig: VerifyStatsSchema.nullable(),
    synthesize: VerifyStatsSchema,
    issues: z.array(VerifyIssueSchema),
  }),
  contextManifest: ReviewContextManifestSchema,
  /** Non-null when the AI was unavailable and the deterministic fallback report was served. */
  fallbackReason: z.string().nullable(),
});

/** Run summary — the projection used by status polls and future run lists. */
export const RunSummarySchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  baseRef: z.string().min(1),
  currentRef: z.string().min(1),
  goal: z.string().nullable(),
  lens: z.string().nullable(),
  status: ReviewRunStatusSchema,
  verdict: VerdictSchema.nullable(),
  qualityScore: z.number().int().min(0).max(100).nullable(),
  error: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

/** `GET /api/reviews/:runId` — summary plus the full result once the run is terminal. */
export const RunDetailResponseSchema = RunSummarySchema.extend({
  result: ReviewRunResultSchema.nullable(),
});

/** SSE events of `GET /api/reviews/:runId/stream` (replayed from the start on connect). */
export const ReviewStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stage"),
    stage: z.enum(["digest", "digest_read", "dig", "synthesize"]),
    state: z.enum(["started", "completed"]),
    latencyMs: z.number().int().optional(),
    salvage: SalvageLadderSchema.optional(),
  }),
  z.object({
    type: z.literal("completed"),
    verdict: VerdictSchema,
    qualityScore: z.number().int(),
    findings: z.number().int().min(0),
    fallbackReason: z.string().nullable(),
  }),
  z.object({ type: z.literal("failed"), error: z.string() }),
  z.object({ type: z.literal("cancelled") }),
]);

export type ReviewRunStatus = z.infer<typeof ReviewRunStatusSchema>;
export type SalvageLadder = z.infer<typeof SalvageLadderSchema>;
export type StartReviewRequest = z.infer<typeof StartReviewRequestSchema>;
export type StartReviewResponse = z.infer<typeof StartReviewResponseSchema>;
export type ReviewPassMeta = z.infer<typeof ReviewPassMetaSchema>;
export type VerifyIssue = z.infer<typeof VerifyIssueSchema>;
export type VerifyStats = z.infer<typeof VerifyStatsSchema>;
export type ReviewContextManifest = z.infer<typeof ReviewContextManifestSchema>;
export type ReviewRunResult = z.infer<typeof ReviewRunResultSchema>;
export type RunSummary = z.infer<typeof RunSummarySchema>;
export type RunDetailResponse = z.infer<typeof RunDetailResponseSchema>;
export type ReviewStreamEvent = z.infer<typeof ReviewStreamEventSchema>;

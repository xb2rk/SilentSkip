import { z } from "zod";

/**
 * What-If chat contracts (E6, decision #28 mechanisms apply).
 *
 * A chat session is scoped to one A/B comparison — `projectId` + `baseRef` + `currentRef` —
 * so designers ask about the branch comparison they care about, not about one run. Sessions
 * and pins live under that scope; pins survive new sessions of the same comparison.
 *
 * Numbers in answers travel as `{{f:<factId>}}` placeholders rendered from the engine fact
 * store, and evidence items carry anchor ids that must exist in the digest registry. The
 * linker enforces both, so nothing stated as evidence can be unanchored.
 */

/** A/B comparison a What-If session belongs to. */
export const WhatIfScopeSchema = z.object({
  projectId: z.string().trim().min(1),
  baseRef: z.string().trim().min(1),
  currentRef: z.string().trim().min(1),
});
export type WhatIfScope = z.infer<typeof WhatIfScopeSchema>;

/** Create-session request — the scope; the title is generated server-side. */
export const StartWhatIfSessionRequestSchema = WhatIfScopeSchema;
export type StartWhatIfSessionRequest = z.infer<typeof StartWhatIfSessionRequestSchema>;

/** Session row as the UI sees it. */
export const WhatIfSessionSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  baseRef: z.string(),
  currentRef: z.string(),
  title: z.string(),
  turnCount: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WhatIfSessionSummary = z.infer<typeof WhatIfSessionSummarySchema>;

/** Session list response (newest first). */
export const WhatIfSessionListResponseSchema = z.object({
  sessions: z.array(WhatIfSessionSummarySchema),
});
export type WhatIfSessionListResponse = z.infer<typeof WhatIfSessionListResponseSchema>;

/** One evidence claim of an answer — a statement that must be backed by anchor ids. */
export const WhatIfEvidenceSchema = z.object({
  statement: z.string().min(1),
  anchors: z.array(z.string()),
});
export type WhatIfEvidence = z.infer<typeof WhatIfEvidenceSchema>;

/** Raw model output for one question, before the linker runs. */
export const WhatIfOutputSchema = z.object({
  answer: z.string().min(1),
  evidence: z.array(WhatIfEvidenceSchema),
  speculation: z.array(z.string()),
  unknowns: z.array(z.string()),
});
export type WhatIfOutput = z.infer<typeof WhatIfOutputSchema>;

/** The linked answer that is persisted and shown (`pinsUsed` is server-added). */
export const WhatIfAnswerSchema = WhatIfOutputSchema.extend({
  pinsUsed: z.array(z.string()),
});
export type WhatIfAnswer = z.infer<typeof WhatIfAnswerSchema>;

/** Context counts shown on the transparency line of one answer. */
export const WhatIfContextCountsSchema = z.object({
  evidence: z.number().int().min(0),
  pins: z.number().int().min(0),
  turns: z.number().int().min(0),
});
export type WhatIfContextCounts = z.infer<typeof WhatIfContextCountsSchema>;

/** Stored payload of an assistant turn: the answer, its context counts, or an honest error. */
export const AssistantTurnDataSchema = z.object({
  answer: WhatIfAnswerSchema.nullable(),
  contextCounts: WhatIfContextCountsSchema.nullable(),
  error: z.string().nullable(),
});
export type AssistantTurnData = z.infer<typeof AssistantTurnDataSchema>;

/** A turn of a session as returned to the UI. */
export const WhatIfTurnSchema = z.object({
  id: z.string(),
  turnIndex: z.number().int().min(0),
  role: z.enum(["user", "assistant"]),
  /** User turns: the question. Assistant turns: rendered answer text ("" while running/failed). */
  content: z.string(),
  /** Structured payload for assistant turns (null for user turns or still-running turns). */
  answer: WhatIfAnswerSchema.nullable(),
  contextCounts: WhatIfContextCountsSchema.nullable(),
  error: z.string().nullable(),
  anchors: z.array(z.string()),
  pinsUsed: z.array(z.string()),
  createdAt: z.string(),
});
export type WhatIfTurn = z.infer<typeof WhatIfTurnSchema>;

/** Session detail: the session plus its turns in order. */
export const WhatIfSessionDetailResponseSchema = z.object({
  session: WhatIfSessionSummarySchema,
  turns: z.array(WhatIfTurnSchema),
});
export type WhatIfSessionDetailResponse = z.infer<typeof WhatIfSessionDetailResponseSchema>;

/** Ask one question inside a session. */
export const AskWhatIfRequestSchema = z.object({
  question: z.string().trim().min(1).max(2000),
});
export type AskWhatIfRequest = z.infer<typeof AskWhatIfRequestSchema>;

/** Accepted ask — the stream for this turn is `GET /api/whatif/turns/:turnId/stream`. */
export const AskWhatIfResponseSchema = z.object({ turnId: z.string() });
export type AskWhatIfResponse = z.infer<typeof AskWhatIfResponseSchema>;

/** Progress stages of one answer: context assembly → the AI call → link verification. */
export const WhatIfStageSchema = z.enum(["context", "ai", "verify"]);
export type WhatIfStage = z.infer<typeof WhatIfStageSchema>;

/** SSE events of one answer. `answer`/`failed` are terminal and then the stream closes. */
export const WhatIfStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stage"),
    stage: WhatIfStageSchema,
    state: z.enum(["started", "completed"]),
    latencyMs: z.number().int().min(0).optional(),
  }),
  z.object({ type: z.literal("answer"), turnId: z.string(), answer: WhatIfAnswerSchema }),
  z.object({ type: z.literal("failed"), turnId: z.string(), error: z.string() }),
]);
export type WhatIfStreamEvent = z.infer<typeof WhatIfStreamEventSchema>;

/** A pinned evidence anchor of one A/B comparison. */
export const PinSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  baseRef: z.string(),
  currentRef: z.string(),
  anchorId: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export type Pin = z.infer<typeof PinSchema>;

/** Pin one anchor of the comparison (validated against the digest registry). */
export const AddPinRequestSchema = z.object({
  projectId: z.string().trim().min(1),
  baseRef: z.string().trim().min(1),
  currentRef: z.string().trim().min(1),
  anchorId: z.string().trim().min(1),
  note: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((value) => (value === undefined || value === "" ? undefined : value)),
});
export type AddPinRequest = z.infer<typeof AddPinRequestSchema>;

/** Pin list response. */
export const PinListResponseSchema = z.object({ pins: z.array(PinSchema) });
export type PinListResponse = z.infer<typeof PinListResponseSchema>;

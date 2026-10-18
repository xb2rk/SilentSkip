import { z } from "zod";
import { VerdictSchema } from "./passes";
import { ReviewRunStatusSchema } from "./review";

/**
 * Run comparison (E9.4) - the honest diff between two stored runs.
 *
 * Only deterministic, persisted data is compared: the engine finding ids stored in the run
 * result and the silent-skip surface entries of each side. AI prose is never set-compared;
 * old runs without `engineFindings` report availability=false instead of pretending empty.
 */

export const ReviewCompareSideSchema = z.object({
  runId: z.string().min(1),
  projectId: z.string().min(1),
  status: ReviewRunStatusSchema,
  verdict: VerdictSchema.nullable(),
  qualityScore: z.number().nullable(),
  createdAt: z.string(),
  durationMs: z.number().nullable(),
  findingsCount: z.number().int().nonnegative(),
  themesCount: z.number().int().nonnegative(),
  unknownsCount: z.number().int().nonnegative(),
  engineFindingsAvailable: z.boolean(),
  surfacesAvailable: z.boolean(),
});

export const ReviewCompareFindingSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  severity: z.string(),
  title: z.string(),
  inLeft: z.boolean(),
  inRight: z.boolean(),
});

export const ReviewCompareSurfaceSchema = z.object({
  id: z.string(),
  table: z.string(),
  rowKey: z.string(),
  column: z.string().nullable(),
  mechanism: z.string(),
  effect: z.string(),
  inLeft: z.boolean(),
  inRight: z.boolean(),
});

export const ReviewCompareResponseSchema = z.object({
  left: ReviewCompareSideSchema,
  right: ReviewCompareSideSchema,
  engineFindings: z.array(ReviewCompareFindingSchema),
  surfaces: z.array(ReviewCompareSurfaceSchema),
  note: z.string(),
});

export const SurfaceHistoryEntrySchema = z.object({
  runId: z.string(),
  createdAt: z.string(),
  verdict: VerdictSchema.nullable(),
  qualityScore: z.number().nullable(),
  newSilent: z.number().int().nonnegative(),
  fixed: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  detectedMechanisms: z.array(z.string()),
});

export const SurfaceHistoryResponseSchema = z.object({
  entries: z.array(SurfaceHistoryEntrySchema),
  skippedLegacy: z.number().int().nonnegative(),
  note: z.string(),
});

export type ReviewCompareSide = z.infer<typeof ReviewCompareSideSchema>;
export type ReviewCompareFinding = z.infer<typeof ReviewCompareFindingSchema>;
export type ReviewCompareSurface = z.infer<typeof ReviewCompareSurfaceSchema>;
export type ReviewCompareResponse = z.infer<typeof ReviewCompareResponseSchema>;
export type SurfaceHistoryEntry = z.infer<typeof SurfaceHistoryEntrySchema>;
export type SurfaceHistoryResponse = z.infer<typeof SurfaceHistoryResponseSchema>;

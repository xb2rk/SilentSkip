import { z } from "zod";

/**
 * Pass I/O contracts — the JSON shapes the AI passes must produce.
 *
 * These schemas are the model-facing boundary: the passes parse every workflow result through
 * them, so a drifting model fails loudly instead of poisoning downstream data. The verifier
 * (E4.3) then strips or downgrades individual claims; schema-valid output is only the floor.
 *
 * Rules encoded here (plan §5.2):
 * - `needMore` is capped at 3 — the `dig` follow-up is one round, never recursive.
 * - Anchors are anchor IDs (strings) copied from the evidence pack; the verifier checks they
 *   exist. Empty arrays are allowed at schema level — an unanchored claim is stripped later,
 *   not treated as a malformed payload.
 */

/** Severity of a claim, aligned with the finding severity scale (plan §4.7). */
export const PassSeveritySchema = z.enum(["critical", "major", "minor", "info"]);

/** How directly the evidence supports a claim. Only `exact` may become a hard finding. */
export const PassConfidenceSchema = z.enum(["exact", "inferred", "unknown"]);

/** Which audience the review is written for (drives tone and what counts as a concern). */
export const ReviewLensSchema = z.enum(["designer", "engineer", "both"]);

/** One claim from a reading pass: statement + anchor IDs + self-assessed severity/confidence. */
export const DigestReadFindingSchema = z.object({
  statement: z.string().min(1),
  anchors: z.array(z.string().min(1)),
  severity: PassSeveritySchema,
  confidence: PassConfidenceSchema,
});

/** Output of pass 1 (`digest_read`): findings, honest unknowns, negative results, ≤3 queries. */
export const DigestReadOutputSchema = z.object({
  findings: z.array(DigestReadFindingSchema),
  unknowns: z.array(z.string().min(1)),
  negativeResults: z.array(z.string().min(1)),
  needMore: z.array(z.string().min(1)).max(3),
});

/** Output of the focused follow-up (`dig`): answers per query + any new findings. No needMore. */
export const DigOutputSchema = z.object({
  findings: z.array(DigestReadFindingSchema),
  unknowns: z.array(z.string().min(1)),
  answers: z.array(z.string().min(1)),
});

/** One final report finding — a reading-pass finding with consequences and a recommendation. */
export const SynthesizeFindingSchema = z.object({
  title: z.string().min(1),
  statement: z.string().min(1),
  anchors: z.array(z.string().min(1)),
  severity: PassSeveritySchema,
  confidence: PassConfidenceSchema,
  consequence: z.string().optional(),
  recommendation: z.string().optional(),
});

/** Report verdict values (plan §5.2; `insufficient_evidence` is a first-class honest answer). */
export const VerdictSchema = z.enum([
  "pass",
  "pass_with_warnings",
  "needs_review",
  "fail",
  "insufficient_evidence",
]);

/** Output of pass `synthesize`: the final review report written over verified findings. */
export const SynthesizeOutputSchema = z.object({
  verdict: VerdictSchema,
  qualityScore: z.number().int().min(0).max(100),
  executiveSummary: z.string().min(1),
  topConcerns: z.array(z.string().min(1)),
  findings: z.array(SynthesizeFindingSchema),
  recommendedTests: z.array(z.string().min(1)),
  unknowns: z.array(z.string().min(1)),
});

export type PassSeverity = z.infer<typeof PassSeveritySchema>;
export type PassConfidence = z.infer<typeof PassConfidenceSchema>;
export type ReviewLens = z.infer<typeof ReviewLensSchema>;
export type DigestReadFinding = z.infer<typeof DigestReadFindingSchema>;
export type DigestReadOutput = z.infer<typeof DigestReadOutputSchema>;
export type DigOutput = z.infer<typeof DigOutputSchema>;
export type SynthesizeFinding = z.infer<typeof SynthesizeFindingSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type SynthesizeOutput = z.infer<typeof SynthesizeOutputSchema>;

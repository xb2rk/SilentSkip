import { z } from "zod";

/**
 * Pass I/O contracts, v2 (E7.2 — decision #28).
 *
 * These schemas are the model-facing boundary and now encode the redesign mechanisms:
 * - Numbers never travel as free text: statements may only carry facts as `{{f:<factId>}}`
 *   placeholders; the linker renders them from engine-computed quantities, so a number that
 *   has no fact cannot be stated at all.
 * - Structural comparisons are typed slots (`claims`): `{subject, relation, object}` over
 *   fact ids; the engine evaluates `equals`/`differs` itself — a false claim is stripped,
 *   never shipped.
 * - `map` refines the engine's mechanical partition (rename only, files exactly once);
 * - `read` runs once per reading unit; `synthesize` writes per theme and may not invent.
 *
 * The linker (packages/ai) is the second gate: schema-valid output is only the floor.
 */

/** Severity of a claim, aligned with the finding severity scale (plan §4.7). */
export const PassSeveritySchema = z.enum(["critical", "major", "minor", "info"]);

/** How directly the evidence supports a claim. Only `exact` may become a hard finding. */
export const PassConfidenceSchema = z.enum(["exact", "inferred", "unknown"]);

/** Which audience the review is written for (drives tone and what counts as a concern). */
export const ReviewLensSchema = z.enum(["designer", "engineer", "both"]);

/** Relation between two numeric facts — evaluated by the engine, never by the model. */
export const ClaimRelationSchema = z.enum(["equals", "differs"]);

/** One typed claim: both sides are fact ids resolvable in the digest's fact index. */
export const TypedClaimSchema = z.object({
  /** Fact id of the left side (a quantity id from facts.json). */
  subject: z.string().min(1),
  relation: ClaimRelationSchema,
  /** Fact id of the right side (a quantity id from facts.json). */
  object: z.string().min(1),
});

/** One reading-pass finding — the atomic unit of the multi-call reading flow. */
export const ReadFindingSchema = z.object({
  title: z.string().min(1),
  /** Numbers only as `{{f:<factId>}}` placeholders; the linker rejects free digits. */
  statement: z.string().min(1),
  anchors: z.array(z.string().min(1)),
  severity: PassSeveritySchema,
  confidence: PassConfidenceSchema,
  /** Typed structural claims — may be empty, never guessed at by prose. */
  claims: z.array(TypedClaimSchema).default([]),
});

/** Output of the `map` pass: themes that refine the engine partition (rename/merge/split). */
export const MapThemeSchema = z.object({
  /** Presentation name (free text) for this part of the change. */
  name: z.string().min(1),
  /** Changed file paths — every changed file exactly once across all themes. */
  files: z.array(z.string().min(1)).min(1),
});

export const MapOutputSchema = z.object({
  themes: z.array(MapThemeSchema).min(1),
});

/** Output of one `read` pass — one reading unit per call. */
export const ReadOutputSchema = z.object({
  findings: z.array(ReadFindingSchema),
  unknowns: z.array(z.string().min(1)),
  negativeResults: z.array(z.string().min(1)),
  needMore: z.array(z.string().min(1)).max(3),
});

/** Output of the focused follow-up (`dig`): answers per query + any new findings. */
export const DigOutputSchema = z.object({
  findings: z.array(ReadFindingSchema),
  unknowns: z.array(z.string().min(1)),
  answers: z.array(z.string().min(1)),
});

/**
 * One theme narrative in the final report — every engine theme id exactly once, written in the
 * three fixed registers (E7.5): what it is, what now happens differently (grounded in
 * `bodies.jsonl`), and what to verify — plus the anchors the narrative stands on.
 */
export const ThemeNarrativeSchema = z.object({
  themeId: z.string().min(1),
  summary: z.string().min(1),
  behaviorChange: z.string().min(1),
  watchFor: z.string().min(1),
  /** Anchor ids backing this narrative — validated by the linker against the registry. */
  anchorIds: z.array(z.string().min(1)).default([]),
});

/** One final report finding — a reading finding with consequences and a recommendation. */
export const SynthesizeFindingSchema = z.object({
  title: z.string().min(1),
  statement: z.string().min(1),
  anchors: z.array(z.string().min(1)),
  severity: PassSeveritySchema,
  confidence: PassConfidenceSchema,
  consequence: z.string().optional(),
  recommendation: z.string().optional(),
  claims: z.array(TypedClaimSchema).default([]),
});

/** Report verdict values (plan §5.2; `insufficient_evidence` is a first-class honest answer). */
export const VerdictSchema = z.enum([
  "pass",
  "pass_with_warnings",
  "needs_review",
  "fail",
  "insufficient_evidence",
]);

/** Output of pass `synthesize`: the final review report written over linked findings. */
export const SynthesizeOutputSchema = z.object({
  verdict: VerdictSchema,
  qualityScore: z.number().int().min(0).max(100),
  executiveSummary: z.string().min(1),
  topConcerns: z.array(z.string().min(1)),
  /** Per-theme narrative — the report's stable narrative structure. */
  themes: z.array(ThemeNarrativeSchema).default([]),
  findings: z.array(SynthesizeFindingSchema),
  recommendedTests: z.array(z.string().min(1)),
  unknowns: z.array(z.string().min(1)),
});

export type PassSeverity = z.infer<typeof PassSeveritySchema>;
export type PassConfidence = z.infer<typeof PassConfidenceSchema>;
export type ReviewLens = z.infer<typeof ReviewLensSchema>;
export type ClaimRelation = z.infer<typeof ClaimRelationSchema>;
export type TypedClaim = z.infer<typeof TypedClaimSchema>;
export type ReadFinding = z.infer<typeof ReadFindingSchema>;
export type MapTheme = z.infer<typeof MapThemeSchema>;
export type MapOutput = z.infer<typeof MapOutputSchema>;
export type ReadOutput = z.infer<typeof ReadOutputSchema>;
export type DigOutput = z.infer<typeof DigOutputSchema>;
export type ThemeNarrative = z.infer<typeof ThemeNarrativeSchema>;
export type SynthesizeFinding = z.infer<typeof SynthesizeFindingSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type SynthesizeOutput = z.infer<typeof SynthesizeOutputSchema>;

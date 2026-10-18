/**
 * Silent-skip surface contracts (E8, spec §4.8).
 *
 * A surface entry records what the game runtime silently does to one row/column of a CSV table:
 * skip it on a length guard, default a value that failed parsing, overwrite a duplicate key, etc.
 * Identity is `table + row key (+ column for cell effects)` — row numbers are witnesses, never
 * identity, so inserting or reordering rows does not create fake surface changes.
 *
 * Only effects the engine can prove from facts are emitted. Mechanisms that need loader/foreign-key
 * intent (`nil_read`, `missing_binding`, `enum_fallback`, `ref_broken`) are not guessed: they land
 * here when the pinned profile gives the engine enough evidence (E8.2).
 */

import { z } from "zod";

/** The six mechanisms the runtime silently applies (spec §4.8). `fixed_skip` is expected, not an entry. */
export const SilentSkipMechanismSchema = z.enum([
  "length_guard",
  "fixed_skip",
  "nil_read",
  "parse_fail",
  "missing_binding",
  "enum_fallback",
  "ref_broken",
  "duplicate_key",
]);

/** What happens to the affected data. */
export const SilentSkipEffectSchema = z.enum([
  "skipped",
  "expected_skip",
  "defaulted",
  "disabled",
  "fallback",
  "last_wins",
]);

/** One proven silent-skip effect. */
export const SilentSkipEntrySchema = z.object({
  /** Stable identity: `table|rowKey|mechanism|column` (no run-specific data). */
  id: z.string().min(1),
  ref: z.enum(["A", "B"]),
  table: z.string().min(1),
  /** PK value; empty only when the row key itself is empty (the witness still points at the row). */
  rowKey: z.string(),
  /** Column label for cell-level effects; null for row/table-level effects. */
  column: z.string().nullable(),
  mechanism: SilentSkipMechanismSchema,
  effect: SilentSkipEffectSchema,
  /** `exact` = every fact in the derivation is exact; `inferred` = documented runtime convention. */
  confidence: z.enum(["exact", "inferred"]),
  detail: z.string().min(1),
  /** Anchor ids of the witnesses (row/header/type row/cell). */
  anchors: z.array(z.string().min(1)),
});

/** Surface of one ref. */
export const SilentSkipSideSchema = z.object({
  ref: z.enum(["A", "B"]),
  entries: z.array(SilentSkipEntrySchema),
  /** Entries omitted beyond the side cap — counted, never silently dropped. */
  truncated: z.number().int().nonnegative(),
});

/** A/B diff of the surface: entries only in B, only in A, and the unchanged intersection. */
export const SilentSkipDeltaSchema = z.object({
  newSilent: z.array(SilentSkipEntrySchema),
  fixed: z.array(SilentSkipEntrySchema),
  unchanged: z.array(SilentSkipEntrySchema),
});

/** Full silent-skip surface of one comparison. */
export const SilentSkipSurfaceSchema = z.object({
  base: SilentSkipSideSchema,
  current: SilentSkipSideSchema,
  delta: SilentSkipDeltaSchema,
  /** Mechanisms actually observed in this comparison (never the full catalog). */
  detectedMechanisms: z.array(SilentSkipMechanismSchema),
  /** Honest coverage statement: what is proven now and what still needs loader/FK intent. */
  note: z.string().min(1),
});

export type SilentSkipMechanism = z.infer<typeof SilentSkipMechanismSchema>;
export type SilentSkipEffect = z.infer<typeof SilentSkipEffectSchema>;
export type SilentSkipEntry = z.infer<typeof SilentSkipEntrySchema>;
export type SilentSkipSide = z.infer<typeof SilentSkipSideSchema>;
export type SilentSkipDelta = z.infer<typeof SilentSkipDeltaSchema>;
export type SilentSkipSurface = z.infer<typeof SilentSkipSurfaceSchema>;

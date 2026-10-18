/**
 * Project Profile contracts — the per-project knowledge that is *data*, not code.
 *
 * The engine assumes only FC grammar, CSV shape and git; everything a project
 * does differently (binding styles, read API families, naming hints, pinned
 * bindings, entity notes) lives here, pinned by the user. Stored as JSON in the
 * `project_profiles` table; the AI Discovery pass (E4) proposes entries with
 * `source: "discovery"` and only the user flips them into accepted knowledge.
 */

import { z } from "zod";

/** How a convention entered the profile: typed by the user or proposed by Discovery. */
export const ConventionSourceSchema = z.enum(["user", "discovery"]);

/** What a convention is about. */
export const ConventionKindSchema = z.enum(["binding", "layout", "naming", "api-family", "other"]);

/** Evidence attached to a convention — a file plus an optional human note. */
export const ConventionEvidenceSchema = z.object({
  file: z.string().min(1),
  note: z.string().min(1).optional(),
});

/** One user-approved (or Discovery-proposed) project convention. */
export const ConventionEntrySchema = z.object({
  id: z.string().min(1),
  kind: ConventionKindSchema,
  /** Human-readable statement, e.g. "CSV tables are read through an index enum in a header file". */
  statement: z.string().min(1),
  evidence: z.array(ConventionEvidenceSchema),
  source: ConventionSourceSchema,
  createdAt: z.string().min(1),
});

/** What an override does. `pin-row-key` names the CSV key column; `pin-binding` names an index enum. */
export const OverrideKindSchema = z.enum([
  "pin-binding",
  "pin-row-key",
  "pin-fk",
  "suppress-finding",
  "entity-note",
]);

/** Target selector of an override; callers use whichever fields identify the target. */
export const OverrideTargetSchema = z.object({
  file: z.string().min(1).optional(),
  symbolId: z.string().min(1).optional(),
  csvPath: z.string().min(1).optional(),
  rowKey: z.string().min(1).optional(),
});

/** One manual override / pin / entity note. */
export const OverrideEntrySchema = z.object({
  id: z.string().min(1),
  kind: OverrideKindSchema,
  target: OverrideTargetSchema,
  /**
   * Override value; free-form by design. `pin-fk` uses
   * `<targetCsvPath>#<int|string|unknown>`, with `target.csvPath` as the referencing
   * table and `target.rowKey` as the referencing column.
   */
  value: z.string().optional(),
  note: z.string().optional(),
  createdAt: z.string().min(1),
});

/** Engine-computed coverage snapshot of the last index run. */
export const CoverageSchema = z.object({
  scriptFiles: z.number().int().nonnegative(),
  csvFiles: z.number().int().nonnegative(),
  generatedAt: z.string().min(1),
  note: z.string().min(1).optional(),
});

/** One pinned "reader binds these CSV columns by name" statement (BIND-01). */
export const ReaderBindingSchema = z.object({
  csvPath: z.string().min(1),
  columns: z.array(z.string().min(1)).min(1),
});

/** One pinned reader loop/guard size (BIND-02). */
export const ReaderGuardSchema = z.object({
  csvPath: z.string().min(1),
  constant: z.number().int().nonnegative(),
});

/** One pinned structured cell whose part references another table (REF-02). */
export const ReaderStructuredCellSchema = z.object({
  csvPath: z.string().min(1),
  column: z.string().min(1),
  targetPath: z.string().min(1),
  split: z.enum(["colon", "pipe"]),
  cast: z.enum(["int", "string"]),
  /** Zero-based part that holds the target row key. */
  part: z.number().int().nonnegative().default(0),
});

/** Declarative reader expectations pinned by the user; never inferred by the engine. */
export const ReaderProfileSchema = z.object({
  bindings: z.array(ReaderBindingSchema),
  guards: z.array(ReaderGuardSchema),
  structuredCells: z.array(ReaderStructuredCellSchema),
});

export type ReaderProfile = z.infer<typeof ReaderProfileSchema>;

/** The full project profile (the DB JSON columns merged into one shape). */
export const ProjectProfileSchema = z.object({
  projectId: z.string().min(1),
  conventions: z.array(ConventionEntrySchema),
  /** Read API families observed or pinned, e.g. `["Strings", "ConfigManager"]`. */
  readApiFamily: z.array(z.string().min(1)),
  overrides: z.array(OverrideEntrySchema),
  readerProfile: ReaderProfileSchema.default({ bindings: [], guards: [], structuredCells: [] }),
  coverage: CoverageSchema.nullable(),
  editorGenIndex: z.boolean(),
  updatedAt: z.string().min(1),
});

/**
 * Writable profile fields (E8.2). `projectId` and `updatedAt` are owned by the server so a
 * client can never point the profile at another project.
 */
export const ProjectProfileUpdateSchema = ProjectProfileSchema.pick({
  conventions: true,
  readApiFamily: true,
  overrides: true,
  readerProfile: true,
  coverage: true,
  editorGenIndex: true,
});

/** Empty reader profile reused by the default and the empty-project builder. */
export const EMPTY_READER_PROFILE: ReaderProfile = {
  bindings: [],
  guards: [],
  structuredCells: [],
};

/**
 * Builds the empty profile for a project that has never been configured.
 *
 * @param projectId - Project row id.
 * @param updatedAt - ISO timestamp supplied by the caller (no clock in contracts).
 */
export function emptyProjectProfile(projectId: string, updatedAt: string): ProjectProfile {
  return {
    projectId,
    conventions: [],
    readApiFamily: [],
    overrides: [],
    readerProfile: EMPTY_READER_PROFILE,
    coverage: null,
    editorGenIndex: false,
    updatedAt,
  };
}

export type ConventionSource = z.infer<typeof ConventionSourceSchema>;
export type ConventionKind = z.infer<typeof ConventionKindSchema>;
export type ConventionEvidence = z.infer<typeof ConventionEvidenceSchema>;
export type ConventionEntry = z.infer<typeof ConventionEntrySchema>;
export type OverrideKind = z.infer<typeof OverrideKindSchema>;
export type OverrideTarget = z.infer<typeof OverrideTargetSchema>;
export type OverrideEntry = z.infer<typeof OverrideEntrySchema>;
export type Coverage = z.infer<typeof CoverageSchema>;
export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;
export type ProjectProfileUpdate = z.infer<typeof ProjectProfileUpdateSchema>;

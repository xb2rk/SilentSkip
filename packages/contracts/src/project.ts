import { z } from "zod";

/**
 * Project registration contracts (E1).
 *
 * A project is a local folder the user registered by absolute path. Registration validates
 * only protective filesystem facts (absolute path, real directory, not a drive root or the
 * home directory) — there is no detection and no guessed classification: the user is the
 * authority on what a project is.
 */

/** A registered project: identity, display name and its absolute root folder. */
export const ProjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  rootPath: z.string(),
  createdAt: z.string(),
  lastIndexedAt: z.string().nullable(),
});

export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

/** Envelope for `GET /api/projects`. */
export const ProjectListResponseSchema = z.object({
  projects: z.array(ProjectSummarySchema),
});

export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;

/** Registration payload: the folder to register plus an optional display-name override. */
export const AddProjectRequestSchema = z.object({
  /** Absolute folder path; trimmed here, validated as a real directory server-side. */
  rootPath: z.string().trim().min(1),
  /** Display name (max 80 chars); defaults to the folder's base name when omitted. */
  name: z.string().trim().min(1).max(80).optional(),
});

export type AddProjectRequest = z.infer<typeof AddProjectRequestSchema>;

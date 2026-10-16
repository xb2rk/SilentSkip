import { z } from "zod";

/**
 * Project registration contracts (E1).
 *
 * A project is a local folder the user registered by absolute path. Registration validates
 * only protective filesystem facts (absolute path, real directory, not a drive root or the
 * home directory) — there is no detection and no guessed classification: the user is the
 * authority on what a project is.
 */

export const ProjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  rootPath: z.string(),
  createdAt: z.string(),
  lastIndexedAt: z.string().nullable(),
});

export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const ProjectListResponseSchema = z.object({
  projects: z.array(ProjectSummarySchema),
});

export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;

export const AddProjectRequestSchema = z.object({
  rootPath: z.string().min(1),
  name: z.string().min(1).optional(),
});

export type AddProjectRequest = z.infer<typeof AddProjectRequestSchema>;

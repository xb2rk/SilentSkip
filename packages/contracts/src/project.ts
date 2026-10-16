import { z } from "zod";

/**
 * Project registration contracts (E1).
 *
 * A project is a Craftland Studio game folder on the local machine registered from inside an
 * allowed root. Detection is evidence-based: a directory qualifies when it shows at least one
 * Craftland marker (`*.gproj`, `Assets/CSV`, `Assets/Script[s]`, or any `.fcc`/`.fcg` file).
 * The server never guesses a project from its name.
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

/** Markers found under a candidate directory — shown to the user as the evidence of detection. */
export const ProjectMarkersSchema = z.object({
  gprojFiles: z.array(z.string()),
  hasCsvDir: z.boolean(),
  hasScriptsDir: z.boolean(),
  fcFileSample: z.string().nullable(),
  isGitRepo: z.boolean(),
});

export type ProjectMarkers = z.infer<typeof ProjectMarkersSchema>;

export const ProjectCandidateSchema = z.object({
  rootPath: z.string(),
  name: z.string(),
  markers: ProjectMarkersSchema,
});

export type ProjectCandidate = z.infer<typeof ProjectCandidateSchema>;

export const DetectProjectsRequestSchema = z.object({
  rootPath: z.string().min(1),
});

export type DetectProjectsRequest = z.infer<typeof DetectProjectsRequestSchema>;

export const DetectProjectsResponseSchema = z.object({
  candidates: z.array(ProjectCandidateSchema),
});

export type DetectProjectsResponse = z.infer<typeof DetectProjectsResponseSchema>;

export const AddProjectRequestSchema = z.object({
  rootPath: z.string().min(1),
  name: z.string().min(1).optional(),
});

export type AddProjectRequest = z.infer<typeof AddProjectRequestSchema>;

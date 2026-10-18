import { z } from "zod";

/**
 * Attribution (E9.3) - "who changed this?" answers straight from git.
 *
 * Attribution is a read-only git projection, never an inference: the file report lists the
 * commits in `base..current` that touched each changed file (plus a worktree flag when the
 * current side is the working tree), and blame maps individual lines to the commit that last
 * wrote them. Uncommitted lines are labelled honestly instead of guessed.
 */

export const ATTRIBUTION_SCHEMA_VERSION = 1;

export const AttributionCommitSchema = z.object({
  commit: z.string(),
  short: z.string(),
  author: z.string(),
  email: z.string(),
  date: z.string(),
  subject: z.string(),
});

export const AttributionFileSchema = z.object({
  path: z.string(),
  commitCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  changedInWorktree: z.boolean(),
  commits: z.array(AttributionCommitSchema),
});

export const AttributionResponseSchema = z.object({
  schemaVersion: z.literal(ATTRIBUTION_SCHEMA_VERSION),
  base: z.string(),
  current: z.string(),
  files: z.array(AttributionFileSchema),
  note: z.string(),
});

export const BlameLineSchema = z.object({
  line: z.number().int().positive(),
  commit: z.string(),
  short: z.string(),
  author: z.string(),
  date: z.string(),
  subject: z.string(),
  uncommitted: z.boolean(),
});

export const BlameResponseSchema = z.object({
  schemaVersion: z.literal(ATTRIBUTION_SCHEMA_VERSION),
  file: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  lines: z.array(BlameLineSchema),
  note: z.string(),
});

export type AttributionCommit = z.infer<typeof AttributionCommitSchema>;
export type AttributionFile = z.infer<typeof AttributionFileSchema>;
export type AttributionResponse = z.infer<typeof AttributionResponseSchema>;
export type BlameLine = z.infer<typeof BlameLineSchema>;
export type BlameResponse = z.infer<typeof BlameResponseSchema>;

import { z } from "zod";

/**
 * Git read contracts (E1). The server only ever reads: refs, commits and diffs go through
 * `execFile("git", [...])` with array arguments — no shell, no writes.
 *
 * `WORKTREE_REF` is the pseudo-ref for "the files as they are on disk right now". It is a
 * valid `current` side only; the `base` side must resolve to a real commit.
 */

/** Pseudo-ref meaning "the working tree as it is on disk"; valid only as the compare `current` side. */
export const WORKTREE_REF = "WORKTREE";

/** Where a ref lives: local branch, remote-tracking branch, or tag. */
export const GitRefKindSchema = z.enum(["branch", "remote", "tag"]);

export type GitRefKind = z.infer<typeof GitRefKindSchema>;

/** One selectable version: its ref name plus the commit it currently points at. */
export const GitRefSchema = z.object({
  name: z.string(),
  kind: GitRefKindSchema,
  commitHash: z.string(),
  subject: z.string(),
  committedAt: z.string().nullable(),
});

export type GitRef = z.infer<typeof GitRefSchema>;

/** Current HEAD commit; `branch` is `null` when HEAD is detached. */
export const GitHeadSchema = z.object({
  branch: z.string().nullable(),
  commitHash: z.string(),
  subject: z.string(),
});

export type GitHead = z.infer<typeof GitHeadSchema>;

/** Everything the A/B picker needs for one project: head, dirty flag and all refs. */
export const ProjectRefsResponseSchema = z.object({
  head: GitHeadSchema.nullable(),
  dirty: z.boolean(),
  refs: z.array(GitRefSchema),
});

export type ProjectRefsResponse = z.infer<typeof ProjectRefsResponseSchema>;

/** Per-file change status. Git copies (`C`) collapse into `R` — the preview treats both as "new path". */
export const DiffFileStatusSchema = z.enum(["A", "M", "D", "R", "U"]);

export type DiffFileStatus = z.infer<typeof DiffFileStatusSchema>;

/** Coarse file classification for the A/B preview; fine-grained probing arrives with the engine. */
export const DiffFileKindSchema = z.enum(["csv", "script", "other"]);

export type DiffFileKind = z.infer<typeof DiffFileKindSchema>;

/** One changed file: status, coarse kind, rename origin, and line counts (`null` = binary/untracked). */
export const DiffFileEntrySchema = z.object({
  path: z.string(),
  oldPath: z.string().nullable(),
  status: DiffFileStatusSchema,
  kind: DiffFileKindSchema,
  additions: z.number().nullable(),
  deletions: z.number().nullable(),
});

export type DiffFileEntry = z.infer<typeof DiffFileEntrySchema>;

/** File-level A/B preview: aggregate counters plus the full changed-file list. */
export const DiffSummarySchema = z.object({
  baseRef: z.string(),
  currentRef: z.string(),
  baseCommit: z.string(),
  currentCommit: z.string().nullable(),
  filesChanged: z.number(),
  additions: z.number(),
  deletions: z.number(),
  untrackedFiles: z.number(),
  csvFiles: z.number(),
  scriptFiles: z.number(),
  files: z.array(DiffFileEntrySchema),
});

export type DiffSummary = z.infer<typeof DiffSummarySchema>;

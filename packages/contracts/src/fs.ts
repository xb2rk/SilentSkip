import { z } from "zod";

/**
 * Read-only filesystem browsing contracts (folder picker).
 *
 * Browsing is explicit navigation: the user walks the real directory tree one level at a
 * time and picks the folder themselves. No recursive scanning, no heuristics — the endpoint
 * is a directory listing and nothing more.
 */

export const FsDirectoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
});

export type FsDirectoryEntry = z.infer<typeof FsDirectoryEntrySchema>;

export const FsListResponseSchema = z.object({
  /** Normalized absolute path being listed; `null` when listing the drive roots. */
  path: z.string().nullable(),
  /** Directory to navigate up to; `null` at the drive-root level. */
  parent: z.string().nullable(),
  directories: z.array(FsDirectoryEntrySchema),
});

export type FsListResponse = z.infer<typeof FsListResponseSchema>;

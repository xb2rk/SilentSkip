import { type Dirent, readdirSync, statSync } from "node:fs";
import { join, parse } from "node:path";
import {
  AppError,
  ErrorCodes,
  type FsDirectoryEntry,
  FsListResponseSchema,
} from "@craftland-qa/contracts";
import { Hono } from "hono";
import { assertDirectoryExists, normalizePath, samePath } from "../paths";

/**
 * Read-only folder browsing for the add-project picker (`GET /api/fs/list`).
 *
 * Explicit one-level navigation: directories only, sorted case-insensitively; with no
 * `path` the drive roots are listed (the filesystem root elsewhere). The endpoint only
 * lists — it never scans recursively and never classifies entries.
 */
export function createFsRoutes(): Hono {
  const app = new Hono();

  app.get("/list", (c) => {
    const requested = c.req.query("path");
    if (requested === undefined || requested.trim() === "") {
      const body = FsListResponseSchema.parse({
        path: null,
        parent: null,
        directories: listDriveRoots(),
      });
      return c.json(body);
    }

    const target = normalizePath(requested);
    assertDirectoryExists(target);

    let entries: Dirent[];
    try {
      entries = readdirSync(target, { withFileTypes: true });
    } catch {
      throw new AppError(ErrorCodes.badRequest, `Không đọc được thư mục: ${target}`);
    }

    const directories: FsDirectoryEntry[] = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, path: normalizePath(join(target, entry.name)) }))
      .sort((a, b) => a.name.localeCompare(b.name, "vi", { sensitivity: "base" }));

    const root = parse(target).root;
    const body = FsListResponseSchema.parse({
      path: target,
      parent: samePath(target, root) ? null : normalizePath(join(target, "..")),
      directories,
    });
    return c.json(body);
  });

  return app;
}

/** Existing drive roots on Windows (C…Z first, then A/B), or the filesystem root elsewhere. */
function listDriveRoots(): FsDirectoryEntry[] {
  if (process.platform !== "win32") {
    return [{ name: "/", path: "/" }];
  }
  const roots: FsDirectoryEntry[] = [];
  for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZAB") {
    const root = `${letter}:\\`;
    try {
      if (statSync(root).isDirectory()) {
        roots.push({ name: root, path: root });
      }
    } catch {
      // Drive not present — skip it.
    }
  }
  return roots;
}

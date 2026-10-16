import { basename } from "node:path";
import { AppError, ErrorCodes, type ProjectSummary } from "@craftland-qa/contracts";
import { type AppDatabase, projects } from "@craftland-qa/db";
import { desc, eq } from "drizzle-orm";
import { assertAddableProjectPath, samePath } from "./paths";

/**
 * Project registry (E1).
 *
 * Registration is fully manual by design: the user picks a folder and that folder is the
 * project — no detection, no marker heuristics. The only validation is the protective
 * filesystem guard in `assertAddableProjectPath`.
 */

/** Register a project by absolute path. Returns the stored summary. */
export function addProject(db: AppDatabase, rootPath: string, name?: string): ProjectSummary {
  const normalized = assertAddableProjectPath(rootPath);

  const existing = db
    .select()
    .from(projects)
    .all()
    .find((row) => samePath(row.rootPath, normalized));
  if (existing !== undefined) {
    throw new AppError(ErrorCodes.conflict, "Dự án này đã có trong danh sách");
  }

  const row: typeof projects.$inferInsert = {
    id: crypto.randomUUID(),
    name: name ?? basename(normalized),
    rootPath: normalized,
    createdAt: new Date(),
    lastIndexedAt: null,
  };
  db.insert(projects).values(row).run();
  return toSummary(row);
}

/** All registered projects, newest first. */
export function listProjects(db: AppDatabase): ProjectSummary[] {
  return db.select().from(projects).orderBy(desc(projects.createdAt)).all().map(toSummary);
}

/** Look up a project or throw NOT_FOUND. */
export function getProject(db: AppDatabase, id: string): ProjectSummary {
  const row = db.select().from(projects).where(eq(projects.id, id)).get();
  if (row === undefined) {
    throw new AppError(ErrorCodes.notFound, "Dự án không tồn tại");
  }
  return toSummary(row);
}

/** Remove a project (and, via cascades, everything derived from it). */
export function removeProject(db: AppDatabase, id: string): void {
  const result = db.delete(projects).where(eq(projects.id, id)).run();
  if (result.changes === 0) {
    throw new AppError(ErrorCodes.notFound, "Dự án không tồn tại");
  }
}

function toSummary(row: {
  id: string;
  name: string;
  rootPath: string;
  createdAt: Date;
  lastIndexedAt?: Date | null | undefined;
}): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.rootPath,
    createdAt: row.createdAt.toISOString(),
    lastIndexedAt: row.lastIndexedAt == null ? null : row.lastIndexedAt.toISOString(),
  };
}

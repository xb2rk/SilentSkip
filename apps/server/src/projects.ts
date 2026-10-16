import { type Dirent, readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
import {
  AppError,
  ErrorCodes,
  type ProjectCandidate,
  type ProjectMarkers,
  type ProjectSummary,
} from "@craftland-qa/contracts";
import { type AppDatabase, projects } from "@craftland-qa/db";
import { desc, eq } from "drizzle-orm";
import { assertDirectoryExists, assertWithinAllowedRoots, normalizePath, samePath } from "./paths";

/**
 * Project registry + workspace detection (E1).
 *
 * Detection is evidence-based and universal: a directory qualifies as a Craftland project
 * when it shows at least one marker (`*.gproj`, an `Assets/CSV` folder, an `Assets/Script[s]`
 * folder, or any `.fcc`/`.fcg` file within a bounded scan). No naming assumptions.
 */

/** Directory names never worth descending into while looking for project roots. */
const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  "library",
  "temp",
  "logs",
  "obj",
  "build",
  "bin",
  "dist",
  "out",
  "saved",
  "intermediate",
  "usersettings",
  "graphify-out",
]);

/** How deep below the requested path we look: self, children, grandchildren. */
const DETECT_MAX_DEPTH = 2;

/** Upper bounds keep detection fast even when pointed at a big folder. */
const MAX_CANDIDATES = 50;
const MAX_SCAN_ENTRIES = 5000;

/**
 * Scan `startPath` (itself, children, grandchildren) for Craftland project roots.
 * The path must live inside an allowed root; candidates are returned with their marker
 * evidence so the UI can show *why* a folder qualified.
 */
export function detectProjectCandidates(
  startPath: string,
  allowedRoots: readonly string[],
): ProjectCandidate[] {
  const start = normalizePath(startPath);
  assertDirectoryExists(start);
  assertWithinAllowedRoots(start, allowedRoots);

  const candidates: ProjectCandidate[] = [];
  let scanned = 0;

  const visit = (dir: string, depth: number): void => {
    if (candidates.length >= MAX_CANDIDATES || scanned >= MAX_SCAN_ENTRIES) return;
    scanned += 1;
    const markers = collectMarkers(dir);
    if (markers !== null) {
      candidates.push({ rootPath: dir, name: basename(dir), markers });
      return; // a project root holds the interesting data — never descend into it
    }
    if (depth >= DETECT_MAX_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (entry.name.startsWith(".") || IGNORED_DIR_NAMES.has(entry.name.toLowerCase())) continue;
      visit(join(dir, entry.name), depth + 1);
    }
  };

  visit(start, 0);
  return candidates;
}

/** Register a project. `rootPath` must exist, pass marker detection and sit inside allowed roots. */
export function addProject(
  db: AppDatabase,
  rootPath: string,
  allowedRoots: readonly string[],
  name?: string,
): ProjectSummary {
  const normalized = normalizePath(rootPath);
  assertDirectoryExists(normalized);
  assertWithinAllowedRoots(normalized, allowedRoots);

  if (collectMarkers(normalized) === null) {
    throw new AppError(
      ErrorCodes.notAProject,
      `Không thấy dấu hiệu project Craftland (*.gproj / Assets\\CSV / file .fcc-.fcg): ${normalized}`,
    );
  }
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

/** Collect marker evidence for `dir`; `null` when the directory shows no Craftland markers. */
function collectMarkers(dir: string): ProjectMarkers | null {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  const gprojFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".gproj"))
    .map((entry) => entry.name);

  const assetsDir = entries.find(
    (entry) => entry.isDirectory() && entry.name.toLowerCase() === "assets",
  );
  let hasCsvDir = false;
  let hasScriptsDir = false;
  let fcFileSample: string | null = null;
  if (assetsDir !== undefined) {
    const assetsPath = join(dir, assetsDir.name);
    let assetEntries: Dirent[];
    try {
      assetEntries = readdirSync(assetsPath, { withFileTypes: true });
    } catch {
      assetEntries = [];
    }
    for (const entry of assetEntries) {
      if (!entry.isDirectory()) continue;
      const lower = entry.name.toLowerCase();
      if (lower === "csv") hasCsvDir = true;
      if (lower === "script" || lower === "scripts") hasScriptsDir = true;
    }
    // FC files only count when they live under this project's own `Assets/` — otherwise a
    // parent folder containing several projects would trivially match via its children.
    fcFileSample = findFirstFcFile(dir, assetsPath, 3);
  }
  const isGitRepo = entries.some((entry) => entry.name === ".git");

  if (gprojFiles.length === 0 && !hasCsvDir && !hasScriptsDir && fcFileSample === null) {
    return null;
  }
  return { gprojFiles, hasCsvDir, hasScriptsDir, fcFileSample, isGitRepo };
}

/** Bounded DFS for the first `.fcc`/`.fcg` file under `scanRoot`, relative to `rootDir`. */
function findFirstFcFile(rootDir: string, scanRoot: string, maxDepth: number): string | null {
  const stack: Array<{ dir: string; depth: number }> = [{ dir: scanRoot, depth: 0 }];
  let visited = 0;
  while (stack.length > 0 && visited < 400) {
    const current = stack.pop();
    if (current === undefined) break;
    visited += 1;
    let entries: Dirent[];
    try {
      entries = readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (lower.endsWith(".fcc") || lower.endsWith(".fcg")) {
        return relative(rootDir, join(current.dir, entry.name));
      }
    }
    if (current.depth >= maxDepth) continue;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (entry.name.startsWith(".") || IGNORED_DIR_NAMES.has(entry.name.toLowerCase())) continue;
      stack.push({ dir: join(current.dir, entry.name), depth: current.depth + 1 });
    }
  }
  return null;
}

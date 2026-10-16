import { type Stats, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { AppError, ErrorCodes } from "@craftland-qa/contracts";

/**
 * Path normalization + the allowed-roots boundary.
 *
 * Product invariant: the tool only reads inside folders the user explicitly allowed
 * (Settings → Dự án được phép). Every user-supplied path passes through here before any
 * filesystem or git call. Comparison is case-insensitive on Windows; symlinks are not
 * resolved (kept simple and predictable).
 */

/** Resolve to an absolute path and strip trailing separators (drive roots like `C:\` kept). */
export function normalizePath(input: string): string {
  const resolved = resolve(input.trim());
  const stripped = resolved.replace(/[\\/]+$/, "");
  return stripped.length > 2 ? stripped : resolved;
}

/** Case-insensitive equality on Windows, exact elsewhere. */
export function samePath(a: string, b: string): boolean {
  return compareKey(a) === compareKey(b);
}

function compareKey(path: string): string {
  const normalized = normalizePath(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

/** True when `child` is `parent` itself or lives under it. */
export function isPathInside(child: string, parent: string): boolean {
  const rel = relative(compareKey(parent), compareKey(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** True when the path is inside at least one allowed root. */
export function isWithinAnyRoot(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => isPathInside(path, root));
}

/** Throw PATH_NOT_ALLOWED unless the path is inside one of the allowed roots. */
export function assertWithinAllowedRoots(path: string, roots: readonly string[]): void {
  if (!isWithinAnyRoot(path, roots)) {
    throw new AppError(
      ErrorCodes.pathNotAllowed,
      `Đường dẫn nằm ngoài thư mục được phép: ${path}`,
      { details: { allowedRoots: [...roots] } },
    );
  }
}

/** Throw unless the path exists and is a directory. */
export function assertDirectoryExists(path: string): void {
  let stats: Stats;
  try {
    stats = statSync(path);
  } catch {
    throw new AppError(ErrorCodes.notFound, `Thư mục không tồn tại: ${path}`);
  }
  if (!stats.isDirectory()) {
    throw new AppError(ErrorCodes.badRequest, `Không phải thư mục: ${path}`);
  }
}

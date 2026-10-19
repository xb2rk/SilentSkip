import { type Stats, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, parse, resolve } from "node:path";
import { AppError, ErrorCodes } from "@silentskip/contracts";

/**
 * Path normalization + registration guards.
 *
 * There is no allowed-roots boundary: the user may register any folder. Registration is
 * still guarded by filesystem facts — the path must be absolute, must exist as a directory,
 * and must not be a drive root or the home directory, which are never project folders and
 * would make later indexing scan far more than intended.
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

/** Validate a project folder registration and return the normalized absolute path. */
export function assertAddableProjectPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") {
    throw new AppError(ErrorCodes.badRequest, "Đường dẫn không được để trống");
  }
  if (!isAbsolute(trimmed)) {
    throw new AppError(
      ErrorCodes.badRequest,
      "Cần đường dẫn tuyệt đối (ví dụ C:\\Projects\\MyGame)",
    );
  }
  const normalized = normalizePath(trimmed);
  if (isRootPath(normalized)) {
    throw new AppError(
      ErrorCodes.badRequest,
      "Không thể thêm gốc ổ đĩa — hãy chọn thư mục dự án cụ thể",
    );
  }
  if (samePath(normalized, homedir())) {
    throw new AppError(
      ErrorCodes.badRequest,
      "Không thể thêm thư mục home — hãy chọn thư mục dự án cụ thể",
    );
  }
  assertDirectoryExists(normalized);
  return normalized;
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

/** True when `input` is a drive root (`C:\`) or the filesystem root (`/`). */
function isRootPath(input: string): boolean {
  const parsed = parse(resolve(input.trim()));
  return samePath(normalizePath(parsed.root), input);
}

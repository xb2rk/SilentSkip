import { type Stats, statSync } from "node:fs";
import { AppError, type AppSettings, ErrorCodes } from "@craftland-qa/contracts";
import { type AppDatabase, appSettings } from "@craftland-qa/db";
import { eq } from "drizzle-orm";
import { normalizePath, samePath } from "./paths";

/**
 * App settings persisted in the `app_settings` key/value table.
 * E1 owns `allowedRoots`; later phases add their keys here (single read/write surface).
 */

const ALLOWED_ROOTS_KEY = "allowedRoots";

/** Read settings, falling back to `defaults` until the user has saved anything. */
export function getSettings(db: AppDatabase, defaults: AppSettings): AppSettings {
  const row = db.select().from(appSettings).where(eq(appSettings.key, ALLOWED_ROOTS_KEY)).get();
  if (row === undefined) return defaults;
  try {
    const parsed: unknown = JSON.parse(row.valueJson);
    const roots = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
    return { allowedRoots: roots };
  } catch {
    return defaults;
  }
}

/**
 * Replace `allowedRoots`. Every entry must be an existing directory; entries are normalized
 * (resolved, trailing separator stripped) and de-duplicated case-insensitively on Windows.
 */
export function updateSettings(
  db: AppDatabase,
  patch: { allowedRoots: readonly string[] },
): AppSettings {
  const roots: string[] = [];
  for (const raw of patch.allowedRoots) {
    const normalized = normalizePath(raw);
    let stats: Stats;
    try {
      stats = statSync(normalized);
    } catch {
      throw new AppError(ErrorCodes.badRequest, `Thư mục không tồn tại: ${raw}`);
    }
    if (!stats.isDirectory()) {
      throw new AppError(ErrorCodes.badRequest, `Không phải thư mục: ${raw}`);
    }
    if (!roots.some((kept) => samePath(kept, normalized))) {
      roots.push(normalized);
    }
  }
  const valueJson = JSON.stringify(roots);
  db.insert(appSettings)
    .values({ key: ALLOWED_ROOTS_KEY, valueJson, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { valueJson, updatedAt: new Date() },
    })
    .run();
  return { allowedRoots: roots };
}

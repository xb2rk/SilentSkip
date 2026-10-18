/**
 * Recently used project paths for the add-project dialog, persisted in localStorage.
 * Local-only convenience — nothing here ever leaves the machine.
 */
const STORAGE_KEY = "silentskip:recent-project-paths";
const MAX_RECENT = 5;

/** Newest first. Never throws (corrupted storage is treated as empty). */
export function readRecentPaths(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string").slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

/** Push a path to the front (deduplicated, capped). Never throws. */
export function pushRecentPath(path: string): void {
  try {
    const next = [path, ...readRecentPaths().filter((item) => item !== path)].slice(0, MAX_RECENT);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — the dialog still works, just without history.
  }
}

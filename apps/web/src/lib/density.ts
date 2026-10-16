/**
 * Display density preference ("Thoáng" = default 16px root, "Gọn" = 14px root).
 *
 * Density is applied by setting `data-density` on <html>; globals.css shrinks rem-based
 * sizes so every component scales uniformly — no second spacing system to maintain.
 */
/** Display density value; "comfortable" is the default product look. */
export type Density = "comfortable" | "compact";

/** localStorage key, shared with the pre-hydration script in index.html. */
export const DENSITY_STORAGE_KEY = "craftland-qa:density";

/** Read the stored density; defaults to "comfortable" when unset or storage is blocked. */
export function readStoredDensity(): Density {
  try {
    return window.localStorage.getItem(DENSITY_STORAGE_KEY) === "compact"
      ? "compact"
      : "comfortable";
  } catch {
    return "comfortable";
  }
}

/** Apply density to <html> immediately (no reload needed). */
export function applyDensity(density: Density): void {
  const root = document.documentElement;
  if (density === "compact") {
    root.dataset.density = "compact";
  } else {
    delete root.dataset.density;
  }
}

/** Persist density; storage failures are ignored (private mode). */
export function persistDensity(density: Density): void {
  try {
    window.localStorage.setItem(DENSITY_STORAGE_KEY, density);
  } catch {
    // Non-fatal: the preference just won't survive a reload.
  }
}

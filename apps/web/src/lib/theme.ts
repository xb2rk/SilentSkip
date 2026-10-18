/**
 * Theme preference helpers. The storage key is duplicated (intentionally) inside the
 * pre-hydration script in index.html — change both together.
 */

/** Persisted theme preference. `system` follows the OS setting. */
export type Theme = "light" | "dark" | "system";

/** localStorage key shared with the index.html pre-hydration script. */
export const THEME_STORAGE_KEY = "silentskip:theme";

/** Resolve the effective theme for a preference, consulting the OS when needed. */
export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return theme;
}

/** Apply the theme to `<html>` (toggles the `dark` class Tailwind v4 is configured for). */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", resolveTheme(theme) === "dark");
}

/** Read the stored preference; defaults to `system`. */
export function readStoredTheme(): Theme {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

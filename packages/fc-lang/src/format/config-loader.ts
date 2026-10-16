/**
 * Upward configuration file resolver for `.fcformatrc.json`, `.fcformatrc`, and `package.json`.
 *
 * @see README.md §Configuration
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FormatOptions } from "./options.js";

const CONFIG_FILENAMES = [
  ".fcformatrc.json",
  ".fcformatrc",
] as const;

/**
 * Searches upward from `startDirectory` for an `.fcformatrc.json` or equivalent configuration file.
 * Returns the parsed options, or an empty object if no config was located.
 */
export function findUpwardConfig(startDirectory: string = process.cwd()): FormatOptions {
  let current = startDirectory;
  let previous = "";

  while (current && current !== previous) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = join(current, filename);
      if (existsSync(candidate)) {
        try {
          const content = readFileSync(candidate, "utf8");
          const parsed = JSON.parse(content) as FormatOptions;
          if (typeof parsed === "object" && parsed !== null) {
            return parsed;
          }
        } catch {
          // If JSON is invalid, return empty options or skip
        }
      }
    }

    const packageJsonPath = join(current, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const pkgContent = readFileSync(packageJsonPath, "utf8");
        const pkg = JSON.parse(pkgContent) as Record<string, unknown>;
        if (pkg && typeof pkg.fcformat === "object" && pkg.fcformat !== null) {
          return pkg.fcformat as FormatOptions;
        }
      } catch {
        // Skip invalid JSON
      }
    }

    previous = current;
    current = dirname(current);
  }

  return {};
}

/** Alias for {@link findUpwardConfig}. */
export const loadFormatConfig = findUpwardConfig;


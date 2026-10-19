import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Access to the checked-in synthetic FC fixture set (`test/fixtures/**`).
 *
 * The fixtures are hand-written `.fcc`/`.fcg` samples that keep the toolchain gate
 * meaningful without shipping any third-party project's sources.
 */

/** Absolute path to the checked-in synthetic FC fixture set. */
export function getFixtureRoot(): string {
  return fileURLToPath(new URL("../fixtures", import.meta.url));
}

/** Collect `.fcc`/`.fcg` fixture files recursively, sorted for deterministic iteration. */
export function collectFixtureFiles(): string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".fcc") || entry.name.endsWith(".fcg")) files.push(full);
    }
  };
  walk(getFixtureRoot());
  return files.sort((a, b) => a.localeCompare(b, "en"));
}

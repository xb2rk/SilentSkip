import { readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Corpus discovery for the vendored-toolchain gate.
 *
 * Why: the corpus is a checked-in copy of the sample project's FC sources (see PROVENANCE.md),
 * so CI can run the full parse/format gate on a clean machine. Adapted from the upstream
 * `tests/helpers/workspace.ts`; the only change is that the root points at `test/corpus`
 * instead of the game repository. Sorting keeps the gate deterministic.
 */

const corpusRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "corpus");

const FC_SOURCE_EXTENSIONS = new Set([".fcc", ".fcg"]);

/** Absolute path of the checked-in corpus root. */
export function getCorpusRoot(): string {
  return corpusRoot;
}

/** All `.fcc`/`.fcg` files under `directory` (default: the corpus root), sorted for determinism. */
export function collectCorpusFiles(directory = corpusRoot): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectCorpusFiles(path));
    } else if (entry.isFile() && FC_SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(path);
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

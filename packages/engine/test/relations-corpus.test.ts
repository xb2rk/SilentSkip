import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFactBundle, buildRelations } from "@silentskip/engine";
import { describe, expect, it } from "vitest";

/**
 * Corpus gate for the relation builder: every checked-in FC source must produce relations
 * without crashing, every relation must carry a non-empty derivation chain, and the build
 * must be deterministic. Intra-file relations only (no CSV paths, single-file bundles).
 */

const corpusRoot = fileURLToPath(new URL("../../fc-lang/test/corpus", import.meta.url));

/** Collect `.fcc`/`.fcg` files recursively, sorted for deterministic iteration. */
function collectFcFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFcFiles(full));
    else if (entry.name.endsWith(".fcc") || entry.name.endsWith(".fcg")) files.push(full);
  }
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

describe("FC corpus relation gate", () => {
  const files = collectFcFiles(corpusRoot);

  it("builds derived, deterministic relations for every corpus file", () => {
    let totalRelations = 0;
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const path = relative(corpusRoot, file).split("\\").join("/");
      const bundle = buildFactBundle([{ path, source }]);
      const first = buildRelations(bundle, { csvPaths: [] });
      const second = buildRelations(bundle, { csvPaths: [] });
      expect(first).toEqual(second);
      for (const relation of first.relations) {
        expect(relation.derivation.length).toBeGreaterThan(0);
        expect(["exact", "inferred", "unknown"]).toContain(relation.confidence);
        expect(relation.id.length).toBeGreaterThan(0);
      }
      totalRelations += first.relations.length;
    }
    expect(totalRelations).toBeGreaterThan(0);
  }, 120_000);
});

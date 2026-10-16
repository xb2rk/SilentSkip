import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFactBundle } from "@craftland-qa/engine";
import { describe, expect, it } from "vitest";

/**
 * Corpus gate for the fact walkers: every checked-in FC source of the sample project
 * (245 files, the same corpus the vendored fc-lang gate uses) must walk without crashing,
 * keep every span raw-faithful, parse cleanly and build deterministically.
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

describe("FC corpus fact gate", () => {
  const files = collectFcFiles(corpusRoot);

  it("covers the full checked-in corpus", () => {
    expect(files).toHaveLength(245);
  });

  it("builds raw-faithful, deterministic facts for every corpus file", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const path = relative(corpusRoot, file).split("\\").join("/");
      const bundle = buildFactBundle([{ path, source }]);

      for (const fileFacts of bundle.files) {
        expect(fileFacts.parse.lexDiagnostics).toBe(0);
        expect(fileFacts.parse.diagnostics).toBe(0);
        expect(fileFacts.parse.consumedThroughEof).toBe(true);

        for (const symbol of fileFacts.symbols) {
          expect(symbol.name.length).toBeGreaterThan(0);
          expect(
            source.slice(symbol.nameSpan.offset, symbol.nameSpan.offset + symbol.nameSpan.length),
          ).toBe(symbol.name);
        }
        for (const ref of fileFacts.refs) {
          expect(source.slice(ref.span.offset, ref.span.offset + ref.span.length)).toBe(ref.name);
        }
        for (const str of fileFacts.strings) {
          expect(source.slice(str.span.offset, str.span.offset + str.span.length)).toBe(
            str.rawText,
          );
        }
      }

      expect(buildFactBundle([{ path, source }])).toEqual(bundle);
    }
  }, 120_000);
});

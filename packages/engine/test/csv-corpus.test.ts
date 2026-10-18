import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "@silentskip/engine";
import { describe, expect, it } from "vitest";
import { expectRawFaithful } from "./helpers/invariants.js";

/**
 * Corpus gate for the CSV parser: every checked-in CSV of the sample project (31 config
 * tables + 2 localization tables) must parse raw-faithfully and deterministically.
 * See `test/corpus/README.md` for provenance.
 */

const corpusRoot = fileURLToPath(new URL("./corpus", import.meta.url));

/** Collect `.csv` files recursively, sorted for deterministic iteration. */
function collectCsvFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectCsvFiles(full));
    else if (entry.name.endsWith(".csv")) files.push(full);
  }
  return files.sort((a, b) => a.localeCompare(b, "en"));
}

describe("CSV corpus gate", () => {
  const files = collectCsvFiles(corpusRoot);

  it("covers the full checked-in corpus", () => {
    expect(files).toHaveLength(33);
  });

  it("parses every corpus file raw-faithfully and deterministically", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const table = parseCsv(source);
      expectRawFaithful(source, table);
      expect(table).toEqual(parseCsv(source));
    }
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "@silentskip/engine";
import { describe, expect, it } from "vitest";
import { expectRawFaithful } from "./helpers/invariants.js";

/**
 * Fixture gate for the CSV parser: every checked-in synthetic CSV fixture (10 config
 * tables + 2 localization tables) must parse raw-faithfully and deterministically.
 * See `test/fixtures/README.md` for details.
 */

const fixtureRoot = fileURLToPath(new URL("./fixtures", import.meta.url));

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

describe("CSV fixture gate", () => {
  const files = collectCsvFiles(fixtureRoot);

  it("covers the full checked-in fixture set", () => {
    expect(files).toHaveLength(12);
  });

  it("parses every fixture file raw-faithfully and deterministically", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const table = parseCsv(source);
      expectRawFaithful(source, table);
      expect(table).toEqual(parseCsv(source));
    }
  });
});

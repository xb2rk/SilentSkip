import { readFileSync } from "node:fs";
import { formatSource, lex, parseGraphFile, parseHeaderFile } from "@craftland-qa/fc-lang";
import { describe, expect, it } from "vitest";
import { collectCorpusFiles } from "./helpers/corpus.js";
import { semanticFingerprint } from "./helpers/semantic-fingerprint.js";

/**
 * Corpus gate for the vendored toolchain (adapted from upstream, see PROVENANCE.md).
 *
 * The vendored language layer must handle every checked-in FC source of the sample project
 * (245 files) exactly as upstream promises: parse without diagnostics, consume through EOF,
 * format idempotently, and preserve semantics. This is the universality proof that the
 * engine can later walk *any* real-world FC file without crashing.
 */
describe("formatter corpus gate (vendored)", () => {
  it("formats, reparses, and stabilizes every checked-in FC source", () => {
    const files = collectCorpusFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const originalLexed = lex(source);
      const originalParsed = file.toLowerCase().endsWith(".fcc")
        ? parseHeaderFile(originalLexed)
        : parseGraphFile(originalLexed);
      expect(originalParsed.diagnostics, file).toEqual([]);
      expect(originalParsed.consumedThroughEof, file).toBe(true);
      const result = formatSource(source, { fileName: file });
      const formatted = result.code;
      if (formatted === undefined) {
        throw new Error(`formatSource returned no code for ${file}`);
      }
      const second = formatSource(formatted, { fileName: file });
      expect(second.diagnostics, file).toEqual([]);
      expect(second.code, file).toBe(formatted);
      const formattedLexed = lex(formatted);
      const parsed = file.toLowerCase().endsWith(".fcc")
        ? parseHeaderFile(formattedLexed)
        : parseGraphFile(formattedLexed);
      expect(parsed.diagnostics, file).toEqual([]);
      expect(parsed.consumedThroughEof, file).toBe(true);
      expect(parsed.node, file).toBeDefined();
      expect(originalParsed.node, file).toBeDefined();
      expect(semanticFingerprint(parsed.node, formattedLexed.tokens), file).toBe(
        semanticFingerprint(originalParsed.node, originalLexed.tokens),
      );
    }
  }, 300_000);
});

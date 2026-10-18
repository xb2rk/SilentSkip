import {
  type LocalizationReport,
  LocalizationReportSchema,
  type LocalizationTableReport,
} from "@silentskip/contracts";
import { describe, expect, it } from "vitest";

import { buildLocalizationReport } from "../src/localization/index.js";

const TABLE = "Assets/Localization/key.csv";

function source(path: string, content: string): { path: string; source: string } {
  return { path, source: content };
}

function report(base: string, current: string): LocalizationReport {
  return LocalizationReportSchema.parse(
    buildLocalizationReport({
      base: { ref: "A", label: "base", sources: [source(TABLE, base)] },
      current: { ref: "B", label: "current", sources: [source(TABLE, current)] },
    }),
  );
}

function table(input: LocalizationReport): LocalizationTableReport {
  const found = input.tables.find((entry) => entry.path === TABLE);
  if (found === undefined) throw new Error("localization table not detected");
  return found;
}

describe("LOC-01 localization report", () => {
  it("detects a language header and skips the optional LanguageKey metadata row", () => {
    const result = report(
      "Key,English,Vietnamese\nHELLO,Hello,Xin chào\n",
      "Key,English,Vietnamese\nLanguageKey,en,vi\nHELLO,Hello,Xin chào\nBYE,Bye,Tạm biệt\n",
    );
    const entry = table(result);
    expect(entry.status).toBe("changed");
    expect(entry.keyCount).toBe(2);
    expect(entry.metadataRowsSkipped).toBe(1);
    expect(entry.sourceColumn).toBe("English");
    expect(entry.languageCount).toBe(2);
    expect(entry.coverage).toEqual([
      { column: "English", filled: 2, empty: 0, total: 2, percent: 100 },
      { column: "Vietnamese", filled: 2, empty: 0, total: 2, percent: 100 },
    ]);
    expect(result.refs).toEqual({ base: "base", current: "current" });
  });

  it("does not treat template.csv or a non-key filename as localization", () => {
    const result = buildLocalizationReport({
      base: { ref: "A", label: "base", sources: [] },
      current: {
        ref: "B",
        label: "current",
        sources: [
          source("Assets/Localization/template.csv", "Key,English,Vietnamese\nA,One,Một\n"),
          source("Assets/Localization/monkey.csv", "Key,English,Vietnamese\nA,One,Một\n"),
        ],
      },
    });
    expect(result.tables).toEqual([]);
    expect(result.note).toContain("No *key.csv");
  });

  it("reports duplicate keys with row anchors and exact samples", () => {
    const result = report(
      "Key,English,Vietnamese\nHELLO,Hello,Xin chào\n",
      "Key,English,Vietnamese\nHELLO,Hello,Xin chào\nBYE,Bye,Tạm biệt\nBYE,Goodbye,Tạm biệt\n",
    );
    const entry = table(result);
    const duplicate = entry.issues.find((issue) => issue.kind === "duplicate-key");
    expect(duplicate?.count).toBe(1);
    expect(duplicate?.samples).toEqual(["BYE"]);
    expect(duplicate?.anchors[0]?.id).toBe(`B:${TABLE}:1:1:csv`);
    expect(duplicate?.anchors.some((anchor) => anchor.loc?.rowKey === "BYE")).toBe(true);
    expect(entry.duplicateKeyCount).toBe(1);
  });

  it("compares placeholders as a multiset, not as a set", () => {
    const result = report(
      "Key,English,Vietnamese\nONE,One {0},{0}\n",
      "Key,English,Vietnamese\nONE,Hello {0} {1},Xin chào {0}\nTWO,Hello,Hello {0}\nTHREE,Hello {0},Xin chào {0}\n",
    );
    const entry = table(result);
    const mismatch = entry.issues.find(
      (issue) => issue.kind === "placeholder-mismatch" && issue.column === "Vietnamese",
    );
    expect(mismatch?.count).toBe(2);
    expect(mismatch?.samples).toEqual(["ONE", "TWO"]);
    expect(entry.placeholderMismatchCount).toBe(2);
    expect(mismatch?.anchors.some((anchor) => anchor.loc?.rowKey === "ONE")).toBe(true);
    expect(mismatch?.anchors.some((anchor) => anchor.loc?.column === "Vietnamese")).toBe(true);
  });

  it("separates empty source strings from empty translations", () => {
    const result = report(
      "Key,English,Vietnamese\nHELLO,Hello,Xin chào\n",
      "Key,English,Vietnamese\nEMPTY,,\nHELLO,Hello,\nBYE,Bye,Tạm biệt\n",
    );
    const entry = table(result);
    const emptySource = entry.issues.find((issue) => issue.kind === "empty-source");
    const emptyTranslation = entry.issues.find(
      (issue) => issue.kind === "empty-translation" && issue.column === "Vietnamese",
    );
    expect(emptySource?.count).toBe(1);
    expect(emptySource?.samples).toEqual(["EMPTY"]);
    expect(emptyTranslation?.count).toBe(1);
    expect(emptyTranslation?.samples).toEqual(["HELLO"]);
    expect(entry.emptyTranslationCount).toBe(1);
  });

  it("reports added and removed keys across the A/B range", () => {
    const result = report(
      "Key,English,Vietnamese\nKEEP,Keep,Giữ\nREMOVED,Removed,Đã xoá\n",
      "Key,English,Vietnamese\nKEEP,Keep,Giữ\nADDED,Added,Đã thêm\n",
    );
    const entry = table(result);
    const added = entry.issues.find((issue) => issue.kind === "key-added");
    const removed = entry.issues.find((issue) => issue.kind === "key-removed");
    expect(added?.count).toBe(1);
    expect(added?.samples).toEqual(["ADDED"]);
    expect(added?.anchors.every((anchor) => anchor.ref === "B")).toBe(true);
    expect(removed?.count).toBe(1);
    expect(removed?.samples).toEqual(["REMOVED"]);
    expect(removed?.anchors.every((anchor) => anchor.ref === "A")).toBe(true);
    expect(result.totals.addedKeys).toBe(1);
    expect(result.totals.removedKeys).toBe(1);
  });

  it("is deterministic and keeps exact blob snippets", () => {
    const base = "Key,English,Vietnamese\nHELLO,Hello,Xin chào\n";
    const current = "Key,English,Vietnamese\nHELLO,Hello {0},Xin chào\n";
    const first = report(base, current);
    const second = report(base, current);
    expect(first).toEqual(second);
    const issue = table(first).issues.find(
      (candidate) => candidate.kind === "placeholder-mismatch",
    );
    expect(issue?.anchors.length).toBeGreaterThan(0);
    for (const anchor of issue?.anchors ?? []) {
      expect(anchor.snippet.length).toBeGreaterThan(0);
      expect(anchor.blobSha).toMatch(/^[0-9a-f]{40}$/u);
      expect(anchor.lineStart).toBeGreaterThan(0);
    }
  });

  it("flags surrounding whitespace in keys", () => {
    const result = report(
      "Key,English,Vietnamese\nHELLO,Hello,Xin chào\n",
      "Key,English,Vietnamese\n HELLO ,Hello,Xin chào\n",
    );
    const entry = table(result);
    const whitespace = entry.issues.find((issue) => issue.kind === "key-whitespace");
    expect(whitespace?.count).toBe(1);
    expect(whitespace?.samples).toEqual([" HELLO "]);
    expect(entry.whitespaceKeyCount).toBe(1);
  });
});

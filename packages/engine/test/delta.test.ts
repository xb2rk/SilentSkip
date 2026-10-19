/**
 * DeltaBundle tests — engineered fixtures for every classification rule plus
 * two fixture-grounded mutations (a real `.fcg` field and a real CSV row) so
 * the rules are proven on genuine project data, not only toy inputs.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CsvTableDelta, DeltaBundle, ScriptFileDelta } from "@silentskip/engine";
import { buildDeltaBundle } from "@silentskip/engine";
import { describe, expect, it } from "vitest";

const FCG_BEFORE = `import "Convert.fcc" as Convert

static graph Config {
  _MOD int = 104729
  func Damage() int {
    return _MOD * 2
  }
  func Removed() int {
    return 1
  }
}
`;

const FCG_AFTER = `import "Convert.fcc" as Convert

static graph Config {
  _MOD int = 104730
  func Damage() int {
    return _MOD * 3
  }
  func Added() int {
    return 2
  }
}
`;

/** Same content as {@link FCG_BEFORE}, members reordered — identity must hold. */
const FCG_REORDERED = `import "Convert.fcc" as Convert

static graph Config {
  func Removed() int {
    return 1
  }
  _MOD int = 104729
  func Damage() int {
    return _MOD * 2
  }
}
`;

const CSV_BEFORE = "id,name,atk\nA,Pea,100\nB,Bow,50\nC,Star,70\n";
const CSV_AFTER = "id,name,atk\nA,Pea,150\nD,New,10\nC,Star,70\n";

/** Builds a one-script delta between two `.fcg` sources. */
function scriptDelta(
  before: string,
  after: string,
  path = "Assets/Scripts/Config.fcg",
): DeltaBundle {
  return buildDeltaBundle({ before: [{ path, source: before }], after: [{ path, source: after }] });
}

/** Returns the single script delta or throws — keeps tests assertion-free. */
function onlyScript(bundle: DeltaBundle): ScriptFileDelta {
  const file = bundle.scripts[0];
  if (file === undefined) throw new Error("expected a script delta");
  return file;
}

/** Returns the single table delta or throws — keeps tests assertion-free. */
function onlyTable(bundle: DeltaBundle): CsvTableDelta {
  const table = bundle.tables[0];
  if (table === undefined) throw new Error("expected a table delta");
  return table;
}

describe("buildDeltaBundle — scripts", () => {
  it("classifies added, removed and changed symbols by stable identity", () => {
    const file = onlyScript(scriptDelta(FCG_BEFORE, FCG_AFTER));
    expect(file.status).toBe("changed");
    expect(file.language).toBe("fcg");
    expect(file.symbolsAdded.map((s) => s.name)).toEqual(["Added"]);
    expect(file.symbolsRemoved.map((s) => s.name)).toEqual(["Removed"]);
    expect(file.symbolsChanged.map((c) => c.name)).toEqual(["_MOD", "Damage"]);
    const mod = file.symbolsChanged.find((c) => c.name === "_MOD");
    expect(mod?.beforeHash).not.toBe(mod?.afterHash);
    expect(mod?.kind).toBe("field");
  });

  it("keeps symbol identity when code moves but text does not change", () => {
    const bundle = scriptDelta(FCG_BEFORE, FCG_REORDERED);
    expect(bundle.scripts).toEqual([]);
  });

  it("reports file-level added and removed with their symbols", () => {
    const bundle = buildDeltaBundle({
      before: [{ path: "a/Old.fcc", source: "enum Old {\n  A = 0\n}\n" }],
      after: [{ path: "b/New.fcg", source: "static graph New {\n  _X int = 1\n}\n" }],
    });
    expect(bundle.scripts.map((s) => [s.path, s.status])).toEqual([
      ["a/Old.fcc", "removed"],
      ["b/New.fcg", "added"],
    ]);
    expect(bundle.scripts[0]?.symbolsRemoved.map((s) => s.name)).toEqual(["Old", "A"]);
    expect(bundle.scripts[1]?.symbolsAdded.map((s) => s.name)).toEqual(["New", "_X"]);
  });

  it("reports import additions and removals", () => {
    const before = `import "Convert.fcc" as Convert\n\nstatic graph G {\n  _A int = 1\n}\n`;
    const after = `import "Convert.fcc" as Convert\nimport "Strings.fcc" as Strings\n\nstatic graph G {\n  _A int = 1\n}\n`;
    const added = onlyScript(scriptDelta(before, after));
    expect(added.importsAdded.map((imp) => imp.path)).toEqual(["Strings.fcc"]);
    expect(added.importsRemoved).toEqual([]);

    const removed = onlyScript(scriptDelta(after, before));
    expect(removed.importsRemoved.map((imp) => imp.path)).toEqual(["Strings.fcc"]);
    expect(removed.importsAdded).toEqual([]);
  });
});

describe("buildDeltaBundle — CSV tables", () => {
  it("classifies added, removed and changed rows with changed columns", () => {
    const table = onlyTable(
      buildDeltaBundle({
        before: [{ path: "Assets/CSV/Item.csv", source: CSV_BEFORE }],
        after: [{ path: "Assets/CSV/Item.csv", source: CSV_AFTER }],
      }),
    );
    expect(table.status).toBe("changed");
    expect(table.headerChanged).toBe(false);
    expect(table.rowsAdded.map((r) => r.key)).toEqual(["D"]);
    expect(table.rowsRemoved.map((r) => r.key)).toEqual(["B"]);
    expect(table.rowsChanged.map((r) => r.key)).toEqual(["A"]);
    const change = table.rowsChanged[0];
    expect(change?.columnsChanged).toEqual([2]);
    expect(change?.before.rowIndex).toBe(1);
    expect(change?.before.line).toBe(2);
    expect(table.rowsRemoved[0]?.rowIndex).toBe(2);
    expect(table.rowsRemoved[0]?.keyKind).toBe("first-column");
  });

  it("flags header changes", () => {
    const table = onlyTable(
      buildDeltaBundle({
        before: [{ path: "t.csv", source: CSV_BEFORE }],
        after: [{ path: "t.csv", source: "id,name,power\nA,Pea,100\nB,Bow,50\nC,Star,70\n" }],
      }),
    );
    expect(table.status).toBe("changed");
    expect(table.headerChanged).toBe(true);
    expect(table.rowsChanged).toEqual([]);
  });

  it("treats .tsv tables as tables instead of crashing on the extension", () => {
    const bundle = buildDeltaBundle({
      before: [{ path: "Assets/CSV/UnitData.tsv", source: "id\tatk\nscout\t100\n" }],
      after: [{ path: "Assets/CSV/UnitData.tsv", source: "id\tatk\nscout\t120\n" }],
    });
    expect(bundle.scripts).toEqual([]);
    const table = onlyTable(bundle);
    expect(table.status).toBe("changed");
    expect(table.rowsChanged.map((r) => r.key)).toEqual(["scout"]);
  });

  it("falls back to row-index keys for empty or duplicate first columns", () => {
    const table = onlyTable(
      buildDeltaBundle({
        before: [{ path: "t.csv", source: "id,v\nX,1\nX,2\n,3\nY,4\n" }],
        after: [{ path: "t.csv", source: "id,v\nX,9\nX,2\n,3\nY,5\n" }],
      }),
    );
    expect(table.rowsChanged.map((r) => [r.key, r.keyKind])).toEqual([
      ["#row:1", "row-index"],
      ["Y", "first-column"],
    ]);
    expect(table.rowsChanged[0]?.columnsChanged).toEqual([1]);
    expect(table.rowsAdded).toEqual([]);
    expect(table.rowsRemoved).toEqual([]);
  });

  it("reports table-level added and removed with their data rows", () => {
    const bundle = buildDeltaBundle({
      before: [{ path: "a.csv", source: "id,v\nA,1\n" }],
      after: [{ path: "b.csv", source: "id,v\nB,2\nC,3\n" }],
    });
    expect(bundle.tables.map((t) => [t.path, t.status])).toEqual([
      ["a.csv", "removed"],
      ["b.csv", "added"],
    ]);
    expect(bundle.tables[0]?.rowsRemoved.map((r) => r.key)).toEqual(["A"]);
    expect(bundle.tables[1]?.rowsAdded.map((r) => r.key)).toEqual(["B", "C"]);
  });

  it("produces an empty delta for identical inputs", () => {
    const bundle = buildDeltaBundle({
      before: [
        { path: "a.fcg", source: FCG_BEFORE },
        { path: "a.csv", source: CSV_BEFORE },
      ],
      after: [
        { path: "a.fcg", source: FCG_BEFORE },
        { path: "a.csv", source: CSV_BEFORE },
      ],
    });
    expect(bundle.scripts).toEqual([]);
    expect(bundle.tables).toEqual([]);
  });
});

describe("buildDeltaBundle — fixture ground truth", () => {
  it("detects a changed field in a checked-in .fcg fixture", () => {
    const path = fileURLToPath(
      new URL("../../fc-lang/test/fixtures/Utils/Math.fcg", import.meta.url),
    );
    const source = readFileSync(path, "utf8");
    const mutated = source.replaceAll("104729", "999983");
    expect(mutated).not.toBe(source);
    const file = onlyScript(scriptDelta(source, mutated, "Utils/TextHash.fcg"));
    expect(file.symbolsChanged.map((c) => c.name)).toEqual(["_MOD"]);
  });

  it("detects a changed row in a checked-in CSV fixture", () => {
    const path = fileURLToPath(new URL("./fixtures/csv/UnitData.csv", import.meta.url));
    const source = readFileSync(path, "utf8");
    const lines = source.split("\n");
    let last = lines.length - 1;
    while (last >= 0 && (lines[last] ?? "").trim() === "") last--;
    const target = (lines[last] ?? "").replace(/\r$/, "");
    if (target === "") throw new Error("fixture CSV unexpectedly empty");
    const mutated = [...lines.slice(0, last), `${target},999`, ...lines.slice(last + 1)].join("\n");

    const table = onlyTable(
      buildDeltaBundle({
        before: [{ path: "UnitData.csv", source }],
        after: [{ path: "UnitData.csv", source: mutated }],
      }),
    );
    expect(table.headerChanged).toBe(false);
    expect(table.rowsAdded).toEqual([]);
    expect(table.rowsRemoved).toEqual([]);
    expect(table.rowsChanged).toHaveLength(1);
    expect(table.rowsChanged[0]?.columnsChanged).toHaveLength(1);
  });
});

describe("buildDeltaBundle — invariants", () => {
  it("is deterministic across runs", () => {
    const input = {
      before: [
        { path: "a/Config.fcg", source: FCG_BEFORE },
        { path: "a/Item.csv", source: CSV_BEFORE },
      ],
      after: [
        { path: "a/Config.fcg", source: FCG_AFTER },
        { path: "a/Item.csv", source: CSV_AFTER },
      ],
    };
    expect(buildDeltaBundle(input)).toEqual(buildDeltaBundle(input));
  });

  it("rejects unsupported extensions and duplicate paths", () => {
    expect(() => buildDeltaBundle({ before: [{ path: "a.txt", source: "" }], after: [] })).toThrow(
      /Unsupported delta source extension/,
    );
    expect(() =>
      buildDeltaBundle({
        before: [
          { path: "a.fcc", source: "" },
          { path: "a.fcc", source: "" },
        ],
        after: [],
      }),
    ).toThrow(/Duplicate delta source path/);
  });
});

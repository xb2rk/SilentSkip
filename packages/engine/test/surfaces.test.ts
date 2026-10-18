import type { ProjectProfile } from "@silentskip/contracts";
import {
  buildDeltaBundle,
  buildFactBundle,
  buildRelations,
  type CheckSide,
  type CsvTable,
  parseCsv,
  type RegisterAnchor,
  runSurfaces,
} from "@silentskip/engine";
import { describe, expect, it } from "vitest";

/**
 * Silent-skip surface gate: every entry must point at real CSV witnesses and identity must stay
 * stable across row moves. Clean tables produce zero entries — an empty surface is a claim, too.
 */

function sideOf(ref: "A" | "B", sources: { path: string; source: string }[]): CheckSide {
  const sourceMap = new Map<string, string>();
  const tables = new Map<string, CsvTable>();
  const scriptSources: { path: string; source: string }[] = [];
  for (const input of sources) {
    sourceMap.set(input.path, input.source);
    if (/\.(csv|tsv)$/iu.test(input.path)) tables.set(input.path, parseCsv(input.source));
    else scriptSources.push(input);
  }
  const bundle = buildFactBundle(scriptSources);
  const factsByPath = new Map(bundle.files.map((file) => [file.path, file] as const));
  return { ref, sources: sourceMap, factsByPath, tables };
}

const REGISTER: RegisterAnchor = (ref, file, span, kind) =>
  `${ref}:${file}:${span.line}:${span.endLine}:${kind}`;

const TABLE_PATH = "Assets/CSV/T.csv";

function surfaces(
  before: { path: string; source: string }[],
  after: { path: string; source: string }[],
  profile?: ProjectProfile,
) {
  const base = sideOf("A", before);
  const current = sideOf("B", after);
  return runSurfaces({
    base,
    current,
    delta: buildDeltaBundle({ before, after }),
    relations: buildRelations(buildFactBundle([]), { csvPaths: [...current.tables.keys()] }),
    ...(profile === undefined ? {} : { profile }),
    registerAnchor: REGISTER,
  });
}

function table(source: string): { path: string; source: string }[] {
  return [{ path: TABLE_PATH, source }];
}

function profileWithPin(csvPath: string, value: string): ProjectProfile {
  return {
    projectId: "p1",
    conventions: [],
    readApiFamily: [],
    overrides: [
      { id: "o1", kind: "pin-row-key", target: { csvPath }, value, createdAt: "2026-01-01" },
    ],
    readerProfile: {
      bindings: [],
      guards: [],
      structuredCells: [],
      nilReads: [],
      enumFallbacks: [],
    },
    coverage: null,
    editorGenIndex: false,
    updatedAt: "2026-01-01",
  };
}

function profileWithReader(
  reader: Partial<ProjectProfile["readerProfile"]>,
  overrides: ProjectProfile["overrides"] = [],
): ProjectProfile {
  return {
    projectId: "p1",
    conventions: [],
    readApiFamily: [],
    overrides,
    readerProfile: {
      bindings: [],
      guards: [],
      structuredCells: [],
      nilReads: [],
      enumFallbacks: [],
      ...reader,
    },
    coverage: null,
    editorGenIndex: false,
    updatedAt: "2026-01-01",
  };
}

describe("silent-skip surfaces", () => {
  it("keeps a clean table empty and states what is not proven", () => {
    const result = surfaces(
      table("id,atk\nscout,100\nguard,80\n"),
      table("id,atk\nscout,110\nguard,80\n"),
    );
    expect(result.base.entries).toEqual([]);
    expect(result.current.entries).toEqual([]);
    expect(result.delta.newSilent).toEqual([]);
    expect(result.detectedMechanisms).toEqual([]);
    expect(result.note).toContain("Observed mechanisms");
    expect(result.note).toContain("nil_read");
  });

  it("does not surface the expected type row or header", () => {
    const result = surfaces(
      table("id,atk\nstring,int\nscout,100\n"),
      table("id,atk\nstring,int\nscout,110\n"),
    );
    expect(result.current.entries).toEqual([]);
  });

  it("records a parse failure per key and column with exact witnesses", () => {
    const result = surfaces(
      table("id,atk\nstring,int\nscout,100\n"),
      table("id,atk\nstring,int\nscout,abc\n"),
    );
    const entries = result.delta.newSilent;
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry?.mechanism).toBe("parse_fail");
    expect(entry?.effect).toBe("defaulted");
    expect(entry?.rowKey).toBe("scout");
    expect(entry?.column).toBe("atk");
    expect(entry?.confidence).toBe("inferred");
    expect(entry?.anchors).toEqual(["B:Assets/CSV/T.csv:2:2:csv", "B:Assets/CSV/T.csv:3:3:csv"]);
    expect(entry?.detail).toContain('"abc"');
  });

  it("becomes exact when the row key is pinned", () => {
    const result = surfaces(
      table("id,atk\nstring,int\nscout,100\n"),
      table("id,atk\nstring,int\nscout,abc\n"),
      profileWithPin(TABLE_PATH, "id"),
    );
    expect(result.delta.newSilent[0]?.confidence).toBe("exact");
  });

  it("records duplicate keys as last-wins only when the key is pinned", () => {
    const unpinned = surfaces(
      table("id,atk\nscout,100\n"),
      table("id,atk\nscout,100\nscout,200\n"),
    );
    expect(unpinned.delta.newSilent).toHaveLength(0);

    const result = surfaces(
      table("id,atk\nscout,100\n"),
      table("id,atk\nscout,100\nscout,200\n"),
      profileWithPin(TABLE_PATH, "id"),
    );
    const entry = result.delta.newSilent.find((item) => item.mechanism === "duplicate_key");
    expect(entry).toBeDefined();
    expect(entry?.rowKey).toBe("scout");
    expect(entry?.effect).toBe("last_wins");
    expect(entry?.confidence).toBe("exact");
    expect(entry?.detail).toContain("lines 2, 3");
    expect(entry?.anchors).toEqual([
      "B:Assets/CSV/T.csv:1:1:csv",
      "B:Assets/CSV/T.csv:2:2:csv",
      "B:Assets/CSV/T.csv:3:3:csv",
    ]);
  });

  it("uses every component of a composite row-key pin", () => {
    const before = "id,slot,v\nPea,1,a\nPea,2,b\n";
    const after = "id,slot,v\nPea,1,a\nPea,2,b\nPea,2,c\n";
    const result = surfaces(table(before), table(after), profileWithPin(TABLE_PATH, "id,slot"));
    const entry = result.delta.newSilent.find((item) => item.mechanism === "duplicate_key");
    expect(entry).toBeDefined();
    expect(entry?.rowKey).toBe("Pea\u001f2");
    expect(entry?.detail).toContain('"Pea | 2"');
  });

  it("records a ragged row as an inferred length-guard skip", () => {
    const result = surfaces(
      table("id,atk\nscout,100\n"),
      table("id,atk\nscout,100\nguard\n"),
    );
    const entry = result.delta.newSilent.find((item) => item.mechanism === "length_guard");
    expect(entry).toBeDefined();
    expect(entry?.rowKey).toBe("guard");
    expect(entry?.effect).toBe("skipped");
    expect(entry?.confidence).toBe("inferred");
    expect(entry?.detail).toContain("1 cell(s)");
  });

  it("keeps identity stable when the row moves between refs", () => {
    const result = surfaces(
      table("id,atk\nstring,int\nscout,abc\nguard,80\n"),
      table("id,atk\nstring,int\nguard,80\nscout,abc\n"),
    );
    expect(result.delta.newSilent).toEqual([]);
    expect(result.delta.fixed).toEqual([]);
    expect(result.delta.unchanged.flatMap((entry) => entry.mechanism)).toEqual(["parse_fail"]);
    expect(result.delta.unchanged[0]?.anchors[1]).toBe("B:Assets/CSV/T.csv:4:4:csv");
  });

  it("moves a fixed cell from newSilent to fixed when parsing recovers", () => {
    const result = surfaces(
      table("id,atk\nstring,int\nscout,abc\n"),
      table("id,atk\nstring,int\nscout,120\n"),
    );
    expect(result.delta.newSilent).toEqual([]);
    expect(result.delta.fixed).toHaveLength(1);
    expect(result.delta.fixed[0]?.ref).toBe("A");
    expect(result.delta.fixed[0]?.mechanism).toBe("parse_fail");
  });

  it("records nil_read only when the reader profile pins the column", () => {
    const unpinned = surfaces(table("id,atk\nPea,100\n"), table("id,atk\nPea,\nguard,80\n"));
    expect(unpinned.current.entries.some((entry) => entry.mechanism === "nil_read")).toBe(false);

    const pinned = surfaces(
      table("id,atk\nPea,100\n"),
      table("id,atk\nPea,\nguard,80\n"),
      profileWithReader({ nilReads: [{ csvPath: TABLE_PATH, column: "atk" }] }),
    );
    const entry = pinned.current.entries.find((item) => item.mechanism === "nil_read");
    expect(entry?.rowKey).toBe("Pea");
    expect(entry?.effect).toBe("disabled");
    expect(entry?.confidence).toBe("exact");
    expect(entry?.anchors).toEqual(["B:Assets/CSV/T.csv:1:1:csv", "B:Assets/CSV/T.csv:2:2:csv"]);
  });

  it("records missing_binding for a pinned column the header lacks", () => {
    const result = surfaces(
      table("id,atk\nPea,100\n"),
      table("id,atk\nPea,100\n"),
      profileWithReader({ bindings: [{ csvPath: TABLE_PATH, columns: ["id", "hp"] }] }),
    );
    const entry = result.current.entries.find((item) => item.mechanism === "missing_binding");
    expect(entry?.column).toBe("hp");
    expect(entry?.effect).toBe("disabled");
    expect(result.delta.unchanged.some((item) => item.mechanism === "missing_binding")).toBe(true);
  });

  it("records enum_fallback for a value outside the pinned enum", () => {
    const script = {
      path: "Assets/Scripts/Kinds.fcc",
      source: "enum EKind {\n  Unit = 0\n  enemy = 1\n}\n",
    };
    const before = [script, ...table("id,kind\nPea,Unit\n")];
    const after = [script, ...table("id,kind\nPea,Boss\n")];
    const result = surfaces(
      before,
      after,
      profileWithReader({
        enumFallbacks: [{ csvPath: TABLE_PATH, column: "kind", enumName: "EKind" }],
      }),
    );
    const entry = result.current.entries.find((item) => item.mechanism === "enum_fallback");
    expect(entry?.rowKey).toBe("Pea");
    expect(entry?.effect).toBe("fallback");
    expect(entry?.detail).toContain('"Boss"');
    expect(entry?.detail).toContain("EKind");
  });

  it("records ref_broken only for pinned FK values with no target row", () => {
    const item = "Assets/CSV/Item.csv";
    const loot = "Assets/CSV/Loot.csv";
    const profile = profileWithReader({}, [
      {
        id: "pin-key",
        kind: "pin-row-key",
        target: { csvPath: item },
        value: "id",
        createdAt: "2026-01-01",
      },
      {
        id: "pin-fk",
        kind: "pin-fk",
        target: { csvPath: loot, rowKey: "item" },
        value: `${item}#int`,
        createdAt: "2026-01-01",
      },
    ]);
    const result = surfaces(
      [
        { path: item, source: "id,title\n100,Sword\n" },
        { path: loot, source: "id,item\nL1,100\n" },
      ],
      [
        { path: item, source: "id,title\n100,Sword\n" },
        { path: loot, source: "id,item\nL1,100\nL2,999\n" },
      ],
      profile,
    );
    const entry = result.current.entries.find((item) => item.mechanism === "ref_broken");
    expect(entry?.table).toBe(loot);
    expect(entry?.rowKey).toBe("L2");
    expect(entry?.column).toBe("item");
    expect(entry?.effect).toBe("fallback");
    expect(entry?.detail).toContain('"999"');
  });
});

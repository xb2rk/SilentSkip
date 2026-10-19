import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  DigestFinding,
  OverrideEntry,
  ProjectProfile,
  ReaderProfile,
} from "@silentskip/contracts";
import { buildDigest } from "@silentskip/engine";
import { describe, expect, it } from "vitest";

/**
 * E8 hardening gate: every injected defect must surface as its owning deterministic rule,
 * and clean inputs must produce zero findings. This runs the real digest pipeline
 * (facts, delta, relations, checks, surfaces), not individual helpers.
 */

type Files = Record<string, string>;

function digest(before: Files, after: Files, profile?: ProjectProfile) {
  return buildDigest({
    base: {
      ref: "A",
      commitHash: null,
      sources: Object.entries(before).map(([path, source]) => ({ path, source })),
    },
    current: {
      ref: "B",
      commitHash: null,
      sources: Object.entries(after).map(([path, source]) => ({ path, source })),
    },
    ...(profile === undefined ? {} : { profile }),
  });
}

const EMPTY_READER: ReaderProfile = {
  bindings: [],
  guards: [],
  structuredCells: [],
  nilReads: [],
  enumFallbacks: [],
};

function evalProfile(options: {
  overrides?: readonly OverrideEntry[];
  reader?: Partial<ReaderProfile>;
  editorGenIndex?: boolean;
}): ProjectProfile {
  return {
    projectId: "eval",
    conventions: [],
    readApiFamily: [],
    overrides: [...(options.overrides ?? [])],
    readerProfile: { ...EMPTY_READER, ...options.reader },
    coverage: null,
    editorGenIndex: options.editorGenIndex ?? false,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function pinRowKey(csvPath: string, value: string): OverrideEntry {
  return {
    id: `pin-row-key:${csvPath}:${value}`,
    kind: "pin-row-key",
    target: { csvPath },
    value,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function pinFk(csvPath: string, column: string, value: string): OverrideEntry {
  return {
    id: `pin-fk:${csvPath}:${column}`,
    kind: "pin-fk",
    target: { csvPath, rowKey: column },
    value,
    note: `${csvPath}.${column}`,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function pinBinding(csvPath: string, value: string): OverrideEntry {
  return {
    id: `pin-binding:${csvPath}`,
    kind: "pin-binding",
    target: { csvPath },
    value,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function findByRule(findings: readonly DigestFinding[], ruleId: string): DigestFinding[] {
  return findings.filter((finding) => finding.ruleId === ruleId);
}

const T = "Assets/CSV/T.csv";
const ITEM = "Assets/CSV/Item.csv";
const LOOT = "Assets/CSV/Loot.csv";
const ITEM_TABLE = "id,title\n100,Sword\n200,Shield\n";
const LOOT_CLEAN = "id,item\nL1,100\n";
const T_CLEAN = "id,atk\nscout,100\nguard,80\n";
const GRAPH = "Assets/Scripts/G.fcg";
const GRAPH_BASE = [
  "static graph G {",
  "  func Helper() int {",
  "    return 7",
  "  }",
  "",
  "  func Use() int {",
  "    return Helper()",
  "  }",
  "}",
  "",
].join("\n");
const GRAPH_AFTER = [
  "static graph G {",
  "  func Use() int {",
  "    return Helper()",
  "  }",
  "}",
  "",
].join("\n");
const CALL = "Assets/Scripts/C.fcg";
const CALL_BASE = [
  "static graph C {",
  "  func Damage(base int) int {",
  "    return base",
  "  }",
  "",
  "  func Fire() int {",
  "    return Damage(2)",
  "  }",
  "}",
  "",
].join("\n");
const CALL_AFTER = [
  "static graph C {",
  "  func Damage(base int, mult int) int {",
  "    return base * mult",
  "  }",
  "",
  "  func Fire() int {",
  "    return Damage(2)",
  "  }",
  "}",
  "",
].join("\n");
const CALL_ORPHAN = CALL_AFTER.replace(
  "  func Fire() int {\n    return Damage(2)\n  }",
  "  func Fire() int {\n    return Damage(2)\n  }\n\n  func Ghost() int {\n    return 9\n  }",
);

interface EvalCase {
  readonly name: string;
  readonly ruleId: string;
  readonly before: Files;
  readonly after: Files;
  readonly profile?: ProjectProfile;
  readonly verify?: (finding: DigestFinding) => void;
}

const CASES: readonly EvalCase[] = [
  {
    name: "STRUCT-01 ragged row",
    ruleId: "STRUCT-01",
    before: { [T]: T_CLEAN },
    after: { [T]: "id,atk\nscout,120\nguard\nranger,50,extra\n" },
  },
  {
    name: "STRUCT-02 duplicate and empty key (inferred)",
    ruleId: "STRUCT-02",
    before: { [T]: T_CLEAN },
    after: { [T]: "id,atk\nscout,100\nscout,120\n,80\n" },
    verify: (finding) => expect(finding.confidence).toBe("inferred"),
  },
  {
    name: "STRUCT-02 duplicate key with a pinned exact key",
    ruleId: "STRUCT-02",
    before: { [T]: T_CLEAN },
    after: { [T]: "id,atk\nscout,100\nscout,120\n,80\n" },
    profile: evalProfile({ overrides: [pinRowKey(T, "id")] }),
    verify: (finding) => expect(finding.confidence).toBe("exact"),
  },
  {
    name: "STRUCT-02 composite pinned key collision",
    ruleId: "STRUCT-02",
    before: { [T]: "id,slot,v\nPea,1,a\nPea,2,b\n" },
    after: { [T]: "id,slot,v\nPea,1,a\nPea,2,b\nPea,2,c\n" },
    profile: evalProfile({ overrides: [pinRowKey(T, "id,slot")] }),
    verify: (finding) => expect(finding.message).toContain("id, slot"),
  },
  {
    name: "STRUCT-02 pinned key column missing from header",
    ruleId: "STRUCT-02",
    before: { [T]: T_CLEAN },
    after: { [T]: "id,atk\nscout,120\nguard,80\n" },
    profile: evalProfile({ overrides: [pinRowKey(T, "nope")] }),
    verify: (finding) => expect(finding.id.endsWith("|pin")).toBe(true),
  },
  {
    name: "STRUCT-03 header hygiene",
    ruleId: "STRUCT-03",
    before: { [T]: T_CLEAN },
    after: { [T]: "id, atk,atk,,Vi\u1ec7t\n1,2,3,4,5\n" },
  },
  {
    name: "TYPE-01 type mismatch and leading zero",
    ruleId: "TYPE-01",
    before: { [T]: "id,price\nint,float\n1,2.5\n" },
    after: { [T]: "id,price\nint,float\n1,2.5\n007,3.5\nx,4\n" },
  },
  {
    name: "BIND-01 pinned name binding targets a missing column",
    ruleId: "BIND-01",
    before: { [T]: T_CLEAN },
    after: { [T]: "id,atk\nscout,120\nguard,80\n" },
    profile: evalProfile({
      reader: {
        bindings: [{ csvPath: T, columns: ["id", "hp"] }],
        guards: [],
        structuredCells: [],
        nilReads: [],
        enumFallbacks: [],
      },
    }),
    verify: (finding) => expect(finding.severity).toBe("critical"),
  },
  {
    name: "BIND-02 guard wider than the header",
    ruleId: "BIND-02",
    before: { [T]: T_CLEAN },
    after: { [T]: "id,atk\nscout,120\nguard,80\n" },
    profile: evalProfile({
      reader: {
        bindings: [],
        guards: [{ csvPath: T, constant: 3 }],
        structuredCells: [],
        nilReads: [],
        enumFallbacks: [],
      },
    }),
    verify: (finding) => expect(finding.severity).toBe("critical"),
  },
  {
    name: "BIND-02 guard stops before the header ends",
    ruleId: "BIND-02",
    before: { [T]: T_CLEAN },
    after: { [T]: "id,atk\nscout,120\nguard,80\n" },
    profile: evalProfile({
      reader: {
        bindings: [],
        guards: [{ csvPath: T, constant: 1 }],
        structuredCells: [],
        nilReads: [],
        enumFallbacks: [],
      },
    }),
    verify: (finding) => expect(finding.severity).toBe("major"),
  },
  {
    name: "DRIFT-01 reordered header without a pin",
    ruleId: "DRIFT-01",
    before: { [T]: "id,atk,hp\n1,2,3\n" },
    after: { [T]: "id,hp,atk\n1,3,2\n" },
    verify: (finding) => expect(finding.effectConfidence).toBe("inferred"),
  },
  {
    name: "DRIFT-01 renamed header without a pin",
    ruleId: "DRIFT-01",
    before: { [T]: "id,atk,hp\n1,2,3\n" },
    after: { [T]: "id,attack,hp\n1,2,3\n" },
  },
  {
    name: "DRIFT-01 rename outside a pinned name binding",
    ruleId: "DRIFT-01",
    before: { [T]: "id,atk,hp\n1,2,3\n" },
    after: { [T]: "id,attack,hp\n1,2,3\n" },
    profile: evalProfile({
      reader: {
        bindings: [{ csvPath: T, columns: ["id", "hp"] }],
        guards: [],
        structuredCells: [],
        nilReads: [],
        enumFallbacks: [],
      },
    }),
    verify: (finding) => expect(finding.severity).toBe("major"),
  },
  {
    name: "REF-01 integer foreign key with no target row",
    ruleId: "REF-01",
    before: { [ITEM]: ITEM_TABLE, [LOOT]: LOOT_CLEAN },
    after: { [ITEM]: ITEM_TABLE, [LOOT]: "id,item\nL1,100\nL2,999\n" },
    profile: evalProfile({
      overrides: [pinRowKey(ITEM, "id"), pinFk(LOOT, "item", `${ITEM}#int`)],
    }),
    verify: (finding) => expect(finding.severity).toBe("major"),
  },
  {
    name: "REF-01 string cast rejects a leading-zero variant",
    ruleId: "REF-01",
    before: { [ITEM]: ITEM_TABLE, [LOOT]: LOOT_CLEAN },
    after: { [ITEM]: ITEM_TABLE, [LOOT]: "id,item\nL1,100\nL2,00100\n" },
    profile: evalProfile({
      overrides: [pinRowKey(ITEM, "id"), pinFk(LOOT, "item", `${ITEM}#string`)],
    }),
  },
  {
    name: "REF-02 malformed structured cell",
    ruleId: "REF-02",
    before: { [ITEM]: ITEM_TABLE, [LOOT]: "id,rewards\nL1,100:2\n" },
    after: { [ITEM]: ITEM_TABLE, [LOOT]: "id,rewards\nL1,100:2\nL2,999:1\nL3,100\nL4,:5\n" },
    profile: evalProfile({
      overrides: [pinRowKey(ITEM, "id")],
      reader: {
        bindings: [],
        guards: [],
        structuredCells: [
          {
            csvPath: LOOT,
            column: "rewards",
            targetPath: ITEM,
            split: "colon",
            cast: "int",
            part: 0,
          },
        ],
      },
    }),
  },
  {
    name: "DANGLING-REF removed symbol still referenced",
    ruleId: "DANGLING-REF",
    before: { [GRAPH]: GRAPH_BASE },
    after: { [GRAPH]: GRAPH_AFTER },
  },
  {
    name: "CALL-ARITY-01 signature grew without the call site",
    ruleId: "CALL-ARITY-01",
    before: { [CALL]: CALL_BASE },
    after: { [CALL]: CALL_AFTER },
  },
  {
    name: "ORPHAN-ADD-01 added function with no scanned reference",
    ruleId: "ORPHAN-ADD-01",
    before: { [CALL]: CALL_BASE },
    after: { [CALL]: CALL_ORPHAN },
    verify: (finding) => expect(finding.effectConfidence).toBe("inferred"),
  },
  {
    name: "BIND-03 stale enum pin",
    ruleId: "BIND-03",
    before: { [T]: T_CLEAN },
    after: { [T]: "id,atk\nscout,120\nguard,80\n" },
    profile: evalProfile({ overrides: [pinBinding(T, "GhostIndex")] }),
    verify: (finding) => expect(finding.id.endsWith("|pin-missing")).toBe(true),
  },
  {
    name: "LOC-01 duplicate localization key",
    ruleId: "LOC-01",
    before: { "Assets/Localization/key.csv": "Key,English,Vietnamese\nHELLO,Hello,Xin chào\n" },
    after: {
      "Assets/Localization/key.csv":
        "Key,English,Vietnamese\nHELLO,Hello,Xin chào\nBYE,Bye,Tạm biệt\nBYE,Goodbye,Tạm biệt\n",
    },
    verify: (finding) => expect(finding.id).toContain("duplicate-key"),
  },
];

describe("E8 hardening gate - injected defects", () => {
  it.each(CASES.map((testCase) => [testCase.name, testCase] as const))(
    "detects %s",
    (_name, testCase) => {
      const result = digest(testCase.before, testCase.after, testCase.profile);
      const findings = findByRule(result.findings, testCase.ruleId);
      expect(
        findings.length,
        `expected ${testCase.ruleId} in ${JSON.stringify(result.findings.map((finding) => finding.id))}`,
      ).toBeGreaterThan(0);
      const first = findings[0];
      if (first === undefined) throw new Error("unreachable");
      testCase.verify?.(first);
    },
  );
});

const LOADER = ["static graph Loader {", '  _PATH string = "Assets/CSV/Item.csv"', "}", ""].join(
  "\n",
);

const CLEAN_REFACTOR_BEFORE = [
  "static graph G {",
  "  func Helper() int {",
  "    return 7",
  "  }",
  "",
  "  func Use() int {",
  "    return Helper()",
  "  }",
  "}",
  "",
].join("\n");
const CLEAN_REFACTOR_AFTER = [
  "static graph G {",
  "  func Compute() int {",
  "    return 7",
  "  }",
  "",
  "  func Use() int {",
  "    return Compute()",
  "  }",
  "}",
  "",
].join("\n");

describe("E8 hardening gate - clean fixtures (0 false positives)", () => {
  it("an unchanged localization table is silent", () => {
    const localization = "Key,English,Vietnamese\nHELLO,Hello,Xin chào\n";
    const result = digest(
      { "Assets/Localization/key.csv": localization },
      { "Assets/Localization/key.csv": localization },
    );
    expect(result.findings).toEqual([]);
  });

  it("a value-only CSV change behind a named loader is silent", () => {
    const result = digest(
      { [ITEM]: ITEM_TABLE, "Assets/Scripts/Loader.fcg": LOADER },
      { [ITEM]: "id,title\n100,Sword\n200,Shield+\n", "Assets/Scripts/Loader.fcg": LOADER },
    );
    expect(result.findings).toEqual([]);
  });

  it("a rename with both sides updated and a removed unused helper is silent", () => {
    const result = digest({ [GRAPH]: CLEAN_REFACTOR_BEFORE }, { [GRAPH]: CLEAN_REFACTOR_AFTER });
    expect(result.findings).toEqual([]);
  });

  it("the checked-in CSV fixtures are silent when unchanged", () => {
    const directory = fileURLToPath(new URL("./fixtures/csv", import.meta.url));
    const files: Files = {};
    for (const name of readdirSync(directory)) {
      files[`Assets/CSV/${name}`] = readFileSync(`${directory}/${name}`, "utf8");
    }
    expect(Object.keys(files).length).toBeGreaterThanOrEqual(10);
    const result = digest(files, files);
    expect(result.findings).toEqual([]);
  });

  it("links EResCSV only when the profile enables editorGen indexing", () => {
    const loader = {
      "Assets/Scripts/EResLoader.fcg": [
        "static graph EResLoader {",
        "  func Load() int {",
        "    return CSVData.ReadCSV(EResCSV.T)",
        "  }",
        "}",
        "",
      ].join("\n"),
    };
    const before = { ...loader, [T]: T_CLEAN };
    const after = { ...loader, [T]: "id,atk\nscout,120\nguard,80\n" };
    expect(findByRule(digest(before, after).findings, "BIND-04")).toHaveLength(1);
    const on = digest(before, after, evalProfile({ editorGenIndex: true }));
    expect(findByRule(on.findings, "BIND-04")).toEqual([]);
  });
});

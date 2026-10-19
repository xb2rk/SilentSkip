import type { ProjectProfile } from "@silentskip/contracts";
import {
  buildDeltaBundle,
  buildFactBundle,
  buildRelations,
  type CheckFinding,
  type CheckSide,
  type CsvTable,
  parseCsv,
  type RegisterAnchor,
  runChecks,
} from "@silentskip/engine";
import { describe, expect, it } from "vitest";

/**
 * Engine checks gate: deterministic findings derived purely from facts. Every test asserts
 * the derivation inputs (anchors, counts, spans) — never just the prose — because a finding
 * that cannot point at its witnesses must not exist.
 */

/** Builds one check side from raw sources, mirroring how the digest wires these maps. */
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

function checks(
  before: { path: string; source: string }[],
  after: { path: string; source: string }[],
  options: { profile?: ProjectProfile } = {},
) {
  const base = sideOf("A", before);
  const current = sideOf("B", after);
  const relations = buildRelations(
    buildFactBundle(after.filter((input) => !/\.(csv|tsv)$/iu.test(input.path))),
    { csvPaths: [...current.tables.keys()] },
  );
  return runChecks({
    base,
    current,
    delta: buildDeltaBundle({ before, after }),
    relations,
    ...(options.profile === undefined ? {} : { profile: options.profile }),
    registerAnchor: REGISTER,
  });
}

/** Findings of one rule only — pair fixtures intentionally trigger several rules. */
function byRule(findings: CheckFinding[], ruleId: string): CheckFinding[] {
  return findings.filter((finding) => finding.ruleId === ruleId);
}

/** Minimal profile carrying one binding override (row-key column or index enum). */
function profileWithPin(
  csvPath: string,
  value: string,
  kind: "pin-binding" | "pin-row-key" = "pin-binding",
): ProjectProfile {
  return {
    projectId: "p1",
    conventions: [],
    readApiFamily: [],
    overrides: [{ id: "o1", kind, target: { csvPath }, value, createdAt: "2026-01-01" }],
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

/** Minimal profile carrying several overrides (row-key pins, FK pins). */
function profileWithOverrides(
  overrides: {
    kind: "pin-binding" | "pin-row-key" | "pin-fk";
    csvPath: string;
    rowKey?: string;
    value: string;
  }[],
): ProjectProfile {
  return {
    projectId: "p1",
    conventions: [],
    readApiFamily: [],
    overrides: overrides.map((override, index) => ({
      id: `o${String(index)}`,
      kind: override.kind,
      target: {
        csvPath: override.csvPath,
        ...(override.rowKey === undefined ? {} : { rowKey: override.rowKey }),
      },
      value: override.value,
      createdAt: "2026-01-01",
    })),
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

function firstFinding(findings: CheckFinding[]): CheckFinding {
  const finding = findings[0];
  if (finding === undefined) throw new Error("expected at least one finding");
  return finding;
}

/** Minimal profile carrying a reader profile (and optional overrides). */
function profileWithReader(
  readerProfile: Partial<ProjectProfile["readerProfile"]>,
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
      ...readerProfile,
    },
    coverage: null,
    editorGenIndex: false,
    updatedAt: "2026-01-01",
  };
}

const TABLE_PATH = "Assets/CSV/T.csv";
const TABLE_CLEAN = "id,atk\nscout,100\nguard,80\n";
const TABLE_RAGGED = "id,atk\nscout,120\nguard\nranger,50,extra\n";

describe("STRUCT-01 row width", () => {
  it("reports rows whose width differs from the header with raw structure witnesses", () => {
    const findings = checks(
      [{ path: TABLE_PATH, source: TABLE_CLEAN }],
      [{ path: TABLE_PATH, source: TABLE_RAGGED }],
    );

    const struct01 = byRule(findings, "STRUCT-01");
    expect(struct01).toHaveLength(1);
    const finding = firstFinding(struct01);
    expect(finding.ruleId).toBe("STRUCT-01");
    expect(finding.id).toBe(`STRUCT-01|B|${TABLE_PATH}`);
    expect(finding.severity).toBe("major");
    expect(finding.confidence).toBe("exact");
    expect(finding.message).toContain("2 of 3 data rows");
    expect(finding.message).toContain("(2 columns)");
    expect(finding.derivation).toHaveLength(3);
    // Header row span plus one anchor per mismatching row, in reading order.
    expect(finding.anchors).toEqual([
      `B:${TABLE_PATH}:1:1:csv`,
      `B:${TABLE_PATH}:3:3:csv`,
      `B:${TABLE_PATH}:4:4:csv`,
    ]);
  });

  it("stays silent when every row matches the header and the pair is clean", () => {
    expect(
      byRule(
        checks(
          [{ path: TABLE_PATH, source: TABLE_CLEAN }],
          [{ path: TABLE_PATH, source: "id,atk\nscout,120\nguard,80\n" }],
        ),
        "STRUCT-01",
      ),
    ).toEqual([]);
    expect(
      byRule(
        checks(
          [{ path: TABLE_PATH, source: TABLE_CLEAN }],
          [{ path: TABLE_PATH, source: TABLE_CLEAN }],
        ),
        "STRUCT-01",
      ),
    ).toEqual([]);
  });

  it("is deterministic", () => {
    const before = [{ path: TABLE_PATH, source: TABLE_CLEAN }];
    const after = [{ path: TABLE_PATH, source: TABLE_RAGGED }];
    expect(checks(before, after)).toEqual(checks(before, after));
  });
});

const GRAPH_PATH = "Assets/Scripts/G.fcg";
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

describe("DANGLING-REF", () => {
  it("reports a removed symbol whose same-name references no longer resolve", () => {
    const findings = checks(
      [{ path: GRAPH_PATH, source: GRAPH_BASE }],
      [{ path: GRAPH_PATH, source: GRAPH_AFTER }],
    );

    expect(findings).toHaveLength(1);
    const finding = firstFinding(findings);
    expect(finding.ruleId).toBe("DANGLING-REF");
    expect(finding.id.startsWith(`DANGLING-REF|${GRAPH_PATH}#Helper@`)).toBe(true);
    expect(finding.severity).toBe("major");
    expect(finding.confidence).toBe("exact");
    expect(finding.message).toContain("unresolved");
    expect(finding.derivation[1]).toContain("resolved exactly");
    // A-side declaration name + A-side reference + B-side unresolved reference.
    expect(finding.anchors).toHaveLength(3);
    expect(finding.anchors[0]?.startsWith(`A:${GRAPH_PATH}:`)).toBe(true);
    expect(finding.anchors[1]?.startsWith(`A:${GRAPH_PATH}:`)).toBe(true);
    expect(finding.anchors[2]?.startsWith(`B:${GRAPH_PATH}:`)).toBe(true);
  });

  it("stays silent when the removed symbol was never referenced", () => {
    const base = [
      "static graph G {",
      "  func Helper() int {",
      "    return 7",
      "  }",
      "",
      "  func Use() int {",
      "    return 7",
      "  }",
      "}",
      "",
    ].join("\n");
    const after = ["static graph G {", "  func Use() int {", "    return 7", "  }", "}", ""].join(
      "\n",
    );
    expect(
      checks([{ path: GRAPH_PATH, source: base }], [{ path: GRAPH_PATH, source: after }]),
    ).toEqual([]);
  });
});

describe("STRUCT-02 row keys", () => {
  const TABLE_DUP = "id,atk\nscout,100\nscout,120\n,80\n";

  it("reports duplicate and empty keys with the inferred first-column note", () => {
    const findings = byRule(
      checks(
        [{ path: TABLE_PATH, source: TABLE_CLEAN }],
        [{ path: TABLE_PATH, source: TABLE_DUP }],
      ),
      "STRUCT-02",
    );
    expect(findings).toHaveLength(1);
    const finding = firstFinding(findings);
    expect(finding.id).toBe(`STRUCT-02|B|${TABLE_PATH}`);
    expect(finding.severity).toBe("major");
    expect(finding.confidence).toBe("inferred");
    expect(finding.message).toContain("1 duplicate row key(s)");
    expect(finding.message).toContain("1 empty row key(s)");
    expect(finding.message).toContain("pin the row-key column");
    expect(finding.derivation[0]).toContain("first column");
    // Header + duplicate witness row (line 3) + empty witness row (line 4).
    expect(finding.anchors).toEqual([
      `B:${TABLE_PATH}:1:1:csv`,
      `B:${TABLE_PATH}:3:3:csv`,
      `B:${TABLE_PATH}:4:4:csv`,
    ]);
  });

  it("becomes exact when the profile pins the key column", () => {
    const findings = byRule(
      checks(
        [{ path: TABLE_PATH, source: TABLE_CLEAN }],
        [{ path: TABLE_PATH, source: TABLE_DUP }],
        { profile: profileWithPin(TABLE_PATH, "id", "pin-row-key") },
      ),
      "STRUCT-02",
    );
    const finding = firstFinding(findings);
    expect(finding.confidence).toBe("exact");
    expect(finding.message).not.toContain("pin the row-key column");
    expect(finding.derivation[0]).toContain('pinned to column(s) "id"');
  });

  it("supports a composite row-key pin", () => {
    const before = "id,slot,v\nPea,1,a\nPea,2,b\n";
    const after = "id,slot,v\nPea,1,a\nPea,2,b\nPea,2,c\n";
    const findings = byRule(
      checks([{ path: TABLE_PATH, source: before }], [{ path: TABLE_PATH, source: after }], {
        profile: profileWithPin(TABLE_PATH, "id,slot", "pin-row-key"),
      }),
      "STRUCT-02",
    );
    const finding = firstFinding(findings);
    expect(finding.severity).toBe("major");
    expect(finding.confidence).toBe("exact");
    expect(finding.message).toContain('key column "id, slot"');
    expect(finding.message).toContain("1 duplicate row key(s)");
  });

  it("does not report repeats of one component under a composite pin", () => {
    const before = "id,slot,v\nPea,1,a\nPea,2,b\n";
    const after = "id,slot,v\nPea,1,a\nPea,2,b\nPea,3,c\n";
    const findings = byRule(
      checks([{ path: TABLE_PATH, source: before }], [{ path: TABLE_PATH, source: after }], {
        profile: profileWithPin(TABLE_PATH, "id,slot", "pin-row-key"),
      }),
      "STRUCT-02",
    );
    expect(findings).toHaveLength(0);
  });

  it("reports a pinned key column that does not exist in the header", () => {
    const findings = byRule(
      checks(
        [{ path: TABLE_PATH, source: TABLE_CLEAN }],
        [{ path: TABLE_PATH, source: "id,atk\nscout,120\nguard,80\n" }],
        { profile: profileWithPin(TABLE_PATH, "nope", "pin-row-key") },
      ),
      "STRUCT-02",
    ).filter((finding) => finding.id.startsWith("STRUCT-02|B|"));
    expect(findings).toHaveLength(1);
    const finding = firstFinding(findings);
    expect(finding.id).toBe(`STRUCT-02|B|${TABLE_PATH}|pin`);
    expect(finding.message).toContain('"nope"');
  });
});

describe("STRUCT-03 header hygiene", () => {
  it("reports empty, duplicate, whitespace and invisible header names", () => {
    const after = "id, atk,atk,,V\u1ec7t,\u200b\n1,2,3,4,5,6\n";
    const findings = byRule(
      checks([{ path: TABLE_PATH, source: TABLE_CLEAN }], [{ path: TABLE_PATH, source: after }]),
      "STRUCT-03",
    );
    expect(findings).toHaveLength(1);
    const finding = firstFinding(findings);
    expect(finding.id).toBe(`STRUCT-03|B|${TABLE_PATH}`);
    expect(finding.severity).toBe("info");
    expect(finding.confidence).toBe("exact");
    expect(finding.message).toContain("1 duplicate name(s)");
    expect(finding.message).toContain("1 empty cell(s)");
    expect(finding.message).toContain("1 name(s) with surrounding whitespace");
    expect(finding.message).toContain(
      "1 name(s) with invisible characters (zero-width or control)",
    );
    // Header row plus four witness cells.
    expect(finding.anchors).toHaveLength(5);
    expect(finding.anchors[0]).toBe(`B:${TABLE_PATH}:1:1:csv`);
  });

  it("does not flag accented header names as hygiene noise", () => {
    const findings = byRule(
      checks(
        [{ path: TABLE_PATH, source: TABLE_CLEAN }],
        [{ path: TABLE_PATH, source: "id,V\u1ec7t\n1,2\n" }],
      ),
      "STRUCT-03",
    );
    expect(findings).toEqual([]);
  });
});

describe("DRIFT-01 header drift", () => {
  it("flags a reordered header at the same column count as critical", () => {
    const before = "id,atk,hp\n1,2,3\n";
    const after = "id,hp,atk\n1,3,2\n";
    const findings = byRule(
      checks([{ path: TABLE_PATH, source: before }], [{ path: TABLE_PATH, source: after }]),
      "DRIFT-01",
    );
    expect(findings).toHaveLength(1);
    const finding = firstFinding(findings);
    expect(finding.id).toBe(`DRIFT-01|B|${TABLE_PATH}`);
    expect(finding.severity).toBe("critical");
    expect(finding.confidence).toBe("exact");
    expect(finding.effectConfidence).toBe("inferred");
    expect(finding.message).toContain("reordered");
    expect(finding.message).toContain('"atk" → "hp"');
    expect(finding.anchors[0]).toBe(`A:${TABLE_PATH}:1:1:csv`);
    expect(finding.anchors[1]).toBe(`B:${TABLE_PATH}:1:1:csv`);
    expect(finding.anchors).toHaveLength(6);
  });

  it("flags a renamed header at the same column count as critical", () => {
    const before = "id,atk,hp\n1,2,3\n";
    const after = "id,attack,hp\n1,2,3\n";
    const findings = byRule(
      checks([{ path: TABLE_PATH, source: before }], [{ path: TABLE_PATH, source: after }]),
      "DRIFT-01",
    );
    expect(findings).toHaveLength(1);
    expect(firstFinding(findings).message).toContain("renamed");
  });

  it("stays silent when a column is added or removed", () => {
    const before = "id,atk\n1,2\n";
    const after = "id,atk,hp\n1,2,3\n";
    const findings = byRule(
      checks([{ path: TABLE_PATH, source: before }], [{ path: TABLE_PATH, source: after }]),
      "DRIFT-01",
    );
    expect(findings).toHaveLength(0);
  });

  it("downgrades a reorder covered by a pinned name binding", () => {
    const before = "id,atk,hp\n1,2,3\n";
    const after = "id,hp,atk\n1,3,2\n";
    const findings = byRule(
      checks([{ path: TABLE_PATH, source: before }], [{ path: TABLE_PATH, source: after }], {
        profile: profileWithReader({
          bindings: [{ csvPath: TABLE_PATH, columns: ["id", "atk", "hp"] }],
          guards: [],
          structuredCells: [],
          nilReads: [],
          enumFallbacks: [],
        }),
      }),
      "DRIFT-01",
    );
    expect(findings).toHaveLength(1);
    const finding = firstFinding(findings);
    expect(finding.severity).toBe("info");
    expect(finding.confidence).toBe("exact");
    expect(finding.effectConfidence).toBe("exact");
    expect(finding.message).toContain("pinned name binding");
    expect(finding.message).toContain("order is irrelevant");
  });

  it("keeps a rename outside the pin as a warning, not a fact", () => {
    const before = "id,atk,hp\n1,2,3\n";
    const after = "id,attack,hp\n1,2,3\n";
    const findings = byRule(
      checks([{ path: TABLE_PATH, source: before }], [{ path: TABLE_PATH, source: after }], {
        profile: profileWithReader({
          bindings: [{ csvPath: TABLE_PATH, columns: ["id", "hp"] }],
          guards: [],
          structuredCells: [],
          nilReads: [],
          enumFallbacks: [],
        }),
      }),
      "DRIFT-01",
    );
    expect(findings).toHaveLength(1);
    const finding = firstFinding(findings);
    expect(finding.severity).toBe("major");
    expect(finding.confidence).toBe("exact");
    expect(finding.effectConfidence).toBe("inferred");
    expect(finding.message).toContain("outside that set");
  });

  it("keeps a missing pinned column critical", () => {
    const before = "id,atk,hp\n1,2,3\n";
    const after = "id,hp,atk\n1,3,2\n";
    const findings = byRule(
      checks([{ path: TABLE_PATH, source: before }], [{ path: TABLE_PATH, source: after }], {
        profile: profileWithReader({
          bindings: [{ csvPath: TABLE_PATH, columns: ["id", "ghost"] }],
          guards: [],
          structuredCells: [],
          nilReads: [],
          enumFallbacks: [],
        }),
      }),
      "DRIFT-01",
    );
    expect(findings).toHaveLength(1);
    const finding = firstFinding(findings);
    expect(finding.severity).toBe("critical");
    expect(finding.effectConfidence).toBe("exact");
    expect(finding.message).toContain('"ghost"');
  });
});

describe("TYPE-01 declared types", () => {
  const TABLE_TYPED = "id,price\nint,float\n1,2.5\n007,3.5\nx,4\n";

  it("reports type mismatches (minor) and leading zeros (info)", () => {
    const findings = byRule(
      checks(
        [{ path: TABLE_PATH, source: TABLE_CLEAN }],
        [{ path: TABLE_PATH, source: TABLE_TYPED }],
      ),
      "TYPE-01",
    );
    const mismatch = findings.find((finding) => finding.id === `TYPE-01|B|${TABLE_PATH}`);
    const leading = findings.find(
      (finding) => finding.id === `TYPE-01|B|${TABLE_PATH}|leading-zero`,
    );
    expect(mismatch).toBeDefined();
    expect(mismatch?.severity).toBe("minor");
    expect(mismatch?.message).toContain('"x"');
    expect(leading).toBeDefined();
    expect(leading?.severity).toBe("info");
    expect(leading?.message).toContain("007");
    expect(findings).toHaveLength(2);
  });
});

describe("BIND-03 / BIND-04 binding channels", () => {
  const FCC_PATH = "Assets/Scripts/Index.fcc";
  const FCC_ENUM = ["enum TCSVIndex {", "  id = 0", "  atk = 1", "  Length = 2", "}", ""].join(
    "\n",
  );
  const CHANGED_TABLE = { path: TABLE_PATH, source: "id,atk\nscout,120\nguard,80\n" };

  it("proposes an inferred candidate when an enum covers every header column", () => {
    const findings = checks(
      [{ path: TABLE_PATH, source: TABLE_CLEAN }],
      [CHANGED_TABLE, { path: FCC_PATH, source: FCC_ENUM }],
    );
    const bind = byRule(findings, "BIND-03");
    expect(bind).toHaveLength(1);
    const finding = firstFinding(bind);
    expect(finding.confidence).toBe("inferred");
    expect(finding.severity).toBe("info");
    expect(finding.message).toContain("TCSVIndex");
    expect(finding.message).toContain("Pin it");
    expect(byRule(findings, "BIND-04")).toEqual([]);
  });

  it("becomes exact with a matching pin and reports a stale pin", () => {
    const pinned = byRule(
      checks(
        [{ path: TABLE_PATH, source: TABLE_CLEAN }],
        [CHANGED_TABLE, { path: FCC_PATH, source: FCC_ENUM }],
        { profile: profileWithPin(TABLE_PATH, "TCSVIndex") },
      ),
      "BIND-03",
    ).filter((finding) => finding.id.startsWith("BIND-03|B|"));
    expect(firstFinding(pinned).confidence).toBe("exact");

    const stale = byRule(
      checks([{ path: TABLE_PATH, source: TABLE_CLEAN }], [CHANGED_TABLE], {
        profile: profileWithPin(TABLE_PATH, "GhostIndex"),
      }),
      "BIND-03",
    ).filter((finding) => finding.id.startsWith("BIND-03|B|"));
    expect(firstFinding(stale).id).toBe(`BIND-03|B|${TABLE_PATH}|pin-missing`);
    expect(firstFinding(stale).message).toContain("GhostIndex");
  });

  it("stays silent when a string literal names the table (channel ①)", () => {
    const LOADER = ["static graph L {", '  _P string = "Assets/CSV/T.csv"', "}", ""].join("\n");
    const findings = checks(
      [{ path: TABLE_PATH, source: TABLE_CLEAN }],
      [CHANGED_TABLE, { path: "Assets/Scripts/L.fcg", source: LOADER }],
    );
    expect(byRule(findings, "BIND-03")).toEqual([]);
    expect(byRule(findings, "BIND-04")).toEqual([]);
  });

  it("reports BIND-04 when nothing references the changed table", () => {
    const findings = byRule(
      checks([{ path: TABLE_PATH, source: TABLE_CLEAN }], [CHANGED_TABLE]),
      "BIND-04",
    );
    const finding = firstFinding(findings);
    expect(finding.id).toBe(`BIND-04|B|${TABLE_PATH}`);
    expect(finding.confidence).toBe("exact");
    expect(finding.title).toContain("No code reference");
  });
});

describe("CALL-ARITY-01 / ORPHAN-ADD-01", () => {
  const CALL_PATH = "Assets/Scripts/C.fcg";
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
  const ORPHAN_AFTER = CALL_AFTER.replace(
    "  func Fire() int {\n    return Damage(2)\n  }",
    "  func Fire() int {\n    return Damage(2)\n  }\n\n  func Ghost() int {\n    return 9\n  }",
  );

  it("reports a call whose arity no longer matches the declaration", () => {
    const findings = byRule(
      checks([{ path: CALL_PATH, source: CALL_BASE }], [{ path: CALL_PATH, source: CALL_AFTER }]),
      "CALL-ARITY-01",
    );
    expect(findings).toHaveLength(1);
    const finding = firstFinding(findings);
    expect(finding.severity).toBe("major");
    expect(finding.confidence).toBe("exact");
    expect(finding.message).toContain("1 argument(s)");
    expect(finding.message).toContain("2 parameter(s)");
    expect(finding.anchors).toHaveLength(2);
  });

  it("stays silent when call sites keep up with the signature", () => {
    const updated = CALL_AFTER.replace("return Damage(2)", "return Damage(2, 3)");
    const findings = byRule(
      checks([{ path: CALL_PATH, source: CALL_BASE }], [{ path: CALL_PATH, source: updated }]),
      "CALL-ARITY-01",
    );
    expect(findings).toEqual([]);
  });

  it("flags an added function that nothing references", () => {
    const findings = byRule(
      checks([{ path: CALL_PATH, source: CALL_BASE }], [{ path: CALL_PATH, source: ORPHAN_AFTER }]),
      "ORPHAN-ADD-01",
    );
    expect(findings).toHaveLength(1);
    const finding = firstFinding(findings);
    expect(finding.severity).toBe("info");
    expect(finding.confidence).toBe("exact");
    expect(finding.effectConfidence).toBe("inferred");
    expect(finding.title).toContain("scanned source");
    expect(finding.message).toContain("Ghost");
    expect(finding.anchors).toHaveLength(1);
  });

  it("is silent once something references the added function", () => {
    const referenced = ORPHAN_AFTER.replace("return Damage(2)", "Ghost()\n    return Damage(2)");
    const findings = byRule(
      checks([{ path: CALL_PATH, source: CALL_BASE }], [{ path: CALL_PATH, source: referenced }]),
      "ORPHAN-ADD-01",
    );
    expect(findings).toEqual([]);
  });
});

describe("CALL-ARITY-01 receiver resolution", () => {
  const CALLER_PATH = "Assets/Scripts/Callers.fcg";
  const SVC_PATH = "Assets/Scripts/Svc.fcg";

  const CALLER = [
    "static graph Caller {",
    "  func Run() int {",
    "    return Svc.Helper(1, 2)",
    "  }",
    "}",
    "",
  ].join("\n");
  const SVC_OK = [
    "static graph Svc {",
    "  func Helper(a int, b int) int {",
    "    return a",
    "  }",
    "}",
    "",
  ].join("\n");

  it("resolves member calls through the receiver's container graph", () => {
    const silent = byRule(
      checks(
        [
          { path: CALLER_PATH, source: CALLER },
          { path: SVC_PATH, source: SVC_OK },
        ],
        [
          { path: CALLER_PATH, source: CALLER },
          { path: SVC_PATH, source: SVC_OK },
        ],
      ),
      "CALL-ARITY-01",
    );
    expect(silent).toEqual([]);

    const svcDrift = SVC_OK.replace("Helper(a int, b int)", "Helper(a int)");
    const findings = byRule(
      checks(
        [
          { path: CALLER_PATH, source: CALLER },
          { path: SVC_PATH, source: SVC_OK },
        ],
        [
          { path: CALLER_PATH, source: CALLER },
          { path: SVC_PATH, source: svcDrift },
        ],
      ),
      "CALL-ARITY-01",
    );
    expect(findings).toHaveLength(1);
    const finding = firstFinding(findings);
    expect(finding.message).toContain("2 argument(s)");
    expect(finding.message).toContain("1 parameter(s)");
  });

  it("counts an out-var argument toward the call arity", () => {
    const caller = [
      "static graph Caller {",
      "  func Run() int {",
      "    return Svc.Pick(out var picked)",
      "  }",
      "}",
      "",
    ].join("\n");
    const svc = [
      "static graph Svc {",
      "  func Pick(out result int) int {",
      "    return 1",
      "  }",
      "}",
      "",
    ].join("\n");
    const findings = byRule(
      checks(
        [
          { path: CALLER_PATH, source: caller },
          { path: SVC_PATH, source: svc },
        ],
        [
          { path: CALLER_PATH, source: caller },
          { path: SVC_PATH, source: svc },
        ],
      ),
      "CALL-ARITY-01",
    );
    // `out var picked` is one argument; the declaration has one parameter, so silence is correct.
    expect(findings).toEqual([]);
  });

  it("stays silent when two containers share the receiver name", () => {
    const caller = [
      "static graph Caller {",
      "  func Run() int {",
      "    return Svc.Helper(1)",
      "  }",
      "}",
      "",
    ].join("\n");
    const svc = [
      "static graph Svc {",
      "  func Helper(a int, b int) int {",
      "    return a",
      "  }",
      "}",
      "",
    ].join("\n");
    const findings = byRule(
      checks(
        [
          { path: CALLER_PATH, source: caller },
          { path: SVC_PATH, source: svc },
          { path: "Assets/Scripts/Svc2.fcg", source: svc },
        ],
        [
          { path: CALLER_PATH, source: caller },
          { path: SVC_PATH, source: svc },
          { path: "Assets/Scripts/Svc2.fcg", source: svc },
        ],
      ),
      "CALL-ARITY-01",
    );
    // Two candidate containers named Svc: resolution is ambiguous, and a guess is never worth a major finding.
    expect(findings).toEqual([]);
  });

  it("stays silent when the receiver is an unknown identifier", () => {
    const caller = [
      "static graph Caller {",
      "  func Run() int {",
      "    return Unknown.Helper(1)",
      "  }",
      "}",
      "",
    ].join("\n");
    const findings = byRule(
      checks([{ path: CALLER_PATH, source: caller }], [{ path: CALLER_PATH, source: caller }]),
      "CALL-ARITY-01",
    );
    expect(findings).toEqual([]);
  });

  it("resolves generic receivers by the type name (entity<T>.Method())", () => {
    const genericCaller = [
      "static graph Z {",
      "  func Run() int {",
      "    var e entity<Srv> = nil",
      "    return e<Srv>.Hit()",
      "  }",
      "}",
      "",
    ].join("\n");
    const srv = ["static graph Srv {", "  func Hit() int {", "    return 1", "  }", "}", ""].join(
      "\n",
    );
    const silent = byRule(
      checks(
        [{ path: CALLER_PATH, source: genericCaller }],
        [
          { path: CALLER_PATH, source: genericCaller },
          { path: SVC_PATH, source: srv },
        ],
      ),
      "CALL-ARITY-01",
    );
    expect(silent).toEqual([]);

    const drifted = genericCaller.replace("e<Srv>.Hit()", "e<Srv>.Hit(1)");
    const findings = byRule(
      checks(
        [{ path: CALLER_PATH, source: genericCaller }],
        [
          { path: CALLER_PATH, source: drifted },
          { path: SVC_PATH, source: srv },
        ],
      ),
      "CALL-ARITY-01",
    );
    expect(findings).toHaveLength(1);
    expect(firstFinding(findings).message).toContain("1 argument(s)");
  });

  it("stays silent when the receiver cannot be resolved — no name-only guessing", () => {
    const trapper = [
      "static graph T {",
      "  func Helper(a int) int {",
      "    return a",
      "  }",
      "",
      "  func Run() int {",
      "    return Mystery.Helper(1, 2)",
      "  }",
      "}",
      "",
    ].join("\n");
    const findings = byRule(
      checks([{ path: CALLER_PATH, source: trapper }], [{ path: CALLER_PATH, source: trapper }]),
      "CALL-ARITY-01",
    );
    expect(findings).toEqual([]);
  });

  it("resolves import-alias receivers through the imported file", () => {
    const caller = [
      'import "Svc.fcg" as SvcLib',
      "static graph Caller2 {",
      "  func Run() int {",
      "    return SvcLib.Helper(1)",
      "  }",
      "}",
      "",
    ].join("\n");
    const lib = [
      "static graph Anything {",
      "  func Helper(a int, b int) int {",
      "    return a",
      "  }",
      "}",
      "",
    ].join("\n");
    const findings = byRule(
      checks(
        [
          { path: CALLER_PATH, source: caller },
          { path: SVC_PATH, source: lib },
        ],
        [
          { path: CALLER_PATH, source: caller },
          { path: SVC_PATH, source: lib },
        ],
      ),
      "CALL-ARITY-01",
    );
    expect(findings).toHaveLength(1);
    expect(firstFinding(findings).message).toContain("1 argument(s)");
    expect(firstFinding(findings).message).toContain("2 parameter(s)");
  });

  it("stays silent when the receiver matches multiple containers", () => {
    // Same graph name in two bundle files — an ambiguous receiver must stay silent.
    const findings = byRule(
      checks(
        [{ path: CALLER_PATH, source: CALLER }],
        [
          { path: CALLER_PATH, source: CALLER },
          { path: SVC_PATH, source: SVC_OK },
          { path: "Assets/Scripts/Other.fcg", source: SVC_OK },
        ],
      ),
      "CALL-ARITY-01",
    );
    expect(findings).toEqual([]);
  });
});

describe("REF-01 foreign keys", () => {
  const ITEM = "Assets/CSV/Item.csv";
  const LOOT = "Assets/CSV/Loot.csv";
  const ITEM_TABLE = "id,title\n100,Sword\n200,Shield\n";
  const LOOT_BEFORE = "id,item\nL1,100\n";
  const LOOT_AFTER = "id,item\nL1,100\nL2,999\nL3,00100\n";
  const PINS = profileWithOverrides([
    { kind: "pin-row-key", csvPath: ITEM, value: "id" },
    { kind: "pin-fk", csvPath: LOOT, rowKey: "item", value: `${ITEM}#int` },
  ]);

  it("reports values with no matching target row under the declared int cast", () => {
    const findings = byRule(
      checks(
        [
          { path: ITEM, source: ITEM_TABLE },
          { path: LOOT, source: LOOT_BEFORE },
        ],
        [
          { path: ITEM, source: ITEM_TABLE },
          { path: LOOT, source: LOOT_AFTER },
        ],
        { profile: PINS },
      ),
      "REF-01",
    );
    expect(findings).toHaveLength(1);
    const finding = firstFinding(findings);
    expect(finding.severity).toBe("major");
    expect(finding.confidence).toBe("exact");
    expect(finding.id).toBe(`REF-01|B|${LOOT}|item|${ITEM}`);
    expect(finding.message).toContain('"999"');
    expect(finding.message).not.toContain('"00100"');
    expect(finding.message).toContain("1 cell(s)");
    // Source header + broken cell + target header.
    expect(finding.anchors).toEqual([
      `B:${LOOT}:1:1:csv`,
      `B:${LOOT}:3:3:csv`,
      `B:${ITEM}:1:1:csv`,
    ]);
  });

  it("uses exact string matching when the cast is string", () => {
    const findings = byRule(
      checks(
        [
          { path: ITEM, source: ITEM_TABLE },
          { path: LOOT, source: LOOT_BEFORE },
        ],
        [
          { path: ITEM, source: ITEM_TABLE },
          { path: LOOT, source: "id,item\nL1,100\nL3,00100\n" },
        ],
        {
          profile: profileWithOverrides([
            { kind: "pin-row-key", csvPath: ITEM, value: "id" },
            { kind: "pin-fk", csvPath: LOOT, rowKey: "item", value: `${ITEM}#string` },
          ]),
        },
      ),
      "REF-01",
    );
    expect(findings).toHaveLength(1);
    expect(firstFinding(findings).message).toContain('"00100"');
    expect(firstFinding(findings).derivation.join(" ")).toContain("exact string equality");
  });

  it("never concludes without a pinned target key", () => {
    const findings = byRule(
      checks(
        [
          { path: ITEM, source: ITEM_TABLE },
          { path: LOOT, source: LOOT_BEFORE },
        ],
        [
          { path: ITEM, source: ITEM_TABLE },
          { path: LOOT, source: LOOT_AFTER },
        ],
        {
          profile: profileWithOverrides([
            { kind: "pin-fk", csvPath: LOOT, rowKey: "item", value: `${ITEM}#int` },
          ]),
        },
      ),
      "REF-01",
    );
    expect(findings).toHaveLength(1);
    expect(firstFinding(findings).severity).toBe("info");
    expect(firstFinding(findings).id).toContain("|target-key-inferred");
  });

  it("never concludes on an unknown cast", () => {
    const findings = byRule(
      checks(
        [
          { path: ITEM, source: ITEM_TABLE },
          { path: LOOT, source: LOOT_BEFORE },
        ],
        [
          { path: ITEM, source: ITEM_TABLE },
          { path: LOOT, source: LOOT_AFTER },
        ],
        {
          profile: profileWithOverrides([
            { kind: "pin-row-key", csvPath: ITEM, value: "id" },
            { kind: "pin-fk", csvPath: LOOT, rowKey: "item", value: `${ITEM}#float` },
          ]),
        },
      ),
      "REF-01",
    );
    expect(findings).toHaveLength(1);
    expect(firstFinding(findings).id).toContain("|cast-unknown");
  });

  it("leaves composite target keys to REF-02 instead of guessing", () => {
    const findings = byRule(
      checks(
        [
          { path: ITEM, source: "id,title\n100,Sword\n" },
          { path: LOOT, source: LOOT_BEFORE },
        ],
        [
          { path: ITEM, source: "id,title\n100,Sword\n" },
          { path: LOOT, source: LOOT_AFTER },
        ],
        {
          profile: profileWithOverrides([
            { kind: "pin-row-key", csvPath: ITEM, value: "id,title" },
            { kind: "pin-fk", csvPath: LOOT, rowKey: "item", value: `${ITEM}#int` },
          ]),
        },
      ),
      "REF-01",
    );
    expect(findings).toHaveLength(1);
    expect(firstFinding(findings).id).toContain("|target-key-composite");
  });
});

describe("BIND-01 / BIND-02 reader profile", () => {
  it("reports a pinned name binding to a missing column", () => {
    const findings = byRule(
      checks(
        [{ path: TABLE_PATH, source: TABLE_CLEAN }],
        [{ path: TABLE_PATH, source: TABLE_CLEAN }],
        {
          profile: profileWithReader({
            bindings: [{ csvPath: TABLE_PATH, columns: ["id", "hp"] }],
            guards: [],
            structuredCells: [],
            nilReads: [],
            enumFallbacks: [],
          }),
        },
      ),
      "BIND-01",
    );
    expect(findings).toHaveLength(1);
    const finding = firstFinding(findings);
    expect(finding.id).toBe(`BIND-01|B|${TABLE_PATH}`);
    expect(finding.severity).toBe("critical");
    expect(finding.confidence).toBe("exact");
    expect(finding.message).toContain('"hp"');
    expect(finding.anchors[0]).toBe(`B:${TABLE_PATH}:1:1:csv`);
  });

  it("accepts a pinned name binding whose columns all exist", () => {
    const findings = byRule(
      checks(
        [{ path: TABLE_PATH, source: TABLE_CLEAN }],
        [{ path: TABLE_PATH, source: TABLE_CLEAN }],
        {
          profile: profileWithReader({
            bindings: [{ csvPath: TABLE_PATH, columns: ["id", "atk"] }],
            guards: [],
            structuredCells: [],
            nilReads: [],
            enumFallbacks: [],
          }),
        },
      ),
      "BIND-01",
    );
    expect(findings).toHaveLength(0);
  });

  it("flags a guard larger than the header as an out-of-bounds risk", () => {
    const findings = byRule(
      checks(
        [{ path: TABLE_PATH, source: TABLE_CLEAN }],
        [{ path: TABLE_PATH, source: TABLE_CLEAN }],
        {
          profile: profileWithReader({
            bindings: [],
            guards: [{ csvPath: TABLE_PATH, constant: 3 }],
            structuredCells: [],
            nilReads: [],
            enumFallbacks: [],
          }),
        },
      ),
      "BIND-02",
    );
    expect(findings).toHaveLength(1);
    const finding = firstFinding(findings);
    expect(finding.id).toBe(`BIND-02|B|${TABLE_PATH}`);
    expect(finding.severity).toBe("critical");
    expect(finding.message).toContain("out of bounds");
  });

  it("flags a smaller guard as trailing columns never read", () => {
    const findings = byRule(
      checks(
        [{ path: TABLE_PATH, source: TABLE_CLEAN }],
        [{ path: TABLE_PATH, source: TABLE_CLEAN }],
        {
          profile: profileWithReader({
            bindings: [],
            guards: [{ csvPath: TABLE_PATH, constant: 1 }],
            structuredCells: [],
            nilReads: [],
            enumFallbacks: [],
          }),
        },
      ),
      "BIND-02",
    );
    expect(findings).toHaveLength(1);
    const finding = firstFinding(findings);
    expect(finding.severity).toBe("major");
    expect(finding.message).toContain("never read");
  });

  it("accepts a guard that equals the header width", () => {
    const findings = byRule(
      checks(
        [{ path: TABLE_PATH, source: TABLE_CLEAN }],
        [{ path: TABLE_PATH, source: TABLE_CLEAN }],
        {
          profile: profileWithReader({
            bindings: [],
            guards: [{ csvPath: TABLE_PATH, constant: 2 }],
            structuredCells: [],
            nilReads: [],
            enumFallbacks: [],
          }),
        },
      ),
      "BIND-02",
    );
    expect(findings).toHaveLength(0);
  });
});

describe("REF-02 structured cells", () => {
  const TARGET = "Assets/CSV/Item.csv";
  const SOURCE = "Assets/CSV/Loot.csv";
  const ITEM_TABLE = "id,title\n100,Sword\n200,Shield\n";
  const SOURCE_BEFORE = "id,rewards\nL1,100:2\n";
  const SOURCE_AFTER = "id,rewards\nL1,100:2\nL2,999:1\nL3,bad\nL4,100\nL5,:5\n";

  function lootProfile(): ProjectProfile {
    return profileWithReader(
      {
        bindings: [],
        guards: [],
        structuredCells: [
          {
            csvPath: SOURCE,
            column: "rewards",
            targetPath: TARGET,
            split: "colon",
            cast: "int",
            part: 0,
          },
        ],
      },
      [
        {
          id: "o1",
          kind: "pin-row-key",
          target: { csvPath: TARGET },
          value: "id",
          createdAt: "2026-01-01",
        },
      ],
    );
  }

  it("reports missing target rows and malformed parts without interpreting the rest", () => {
    const findings = byRule(
      checks(
        [
          { path: TARGET, source: ITEM_TABLE },
          { path: SOURCE, source: SOURCE_BEFORE },
        ],
        [
          { path: TARGET, source: ITEM_TABLE },
          { path: SOURCE, source: SOURCE_AFTER },
        ],
        { profile: lootProfile() },
      ),
      "REF-02",
    );
    expect(findings).toHaveLength(1);
    const finding = firstFinding(findings);
    expect(finding.id).toBe(`REF-02|B|${SOURCE}|rewards|${TARGET}`);
    expect(finding.severity).toBe("major");
    expect(finding.confidence).toBe("exact");
    expect(finding.message).toContain("3 cell(s)");
    expect(finding.message).toContain("1 malformed");
    expect(finding.message).toContain('"999:1" (line 3)');
    expect(finding.anchors[1]).toBe(`B:${SOURCE}:3:3:csv`);
  });

  it("stays silent when every structured part resolves", () => {
    const findings = byRule(
      checks(
        [
          { path: TARGET, source: ITEM_TABLE },
          { path: SOURCE, source: SOURCE_BEFORE },
        ],
        [
          { path: TARGET, source: ITEM_TABLE },
          { path: SOURCE, source: "id,rewards\nL1,100:2\nL2,200:5\n" },
        ],
        { profile: lootProfile() },
      ),
      "REF-02",
    );
    expect(findings).toHaveLength(0);
  });

  it("checks every entry of a pair list and reports the broken one", () => {
    const profile = profileWithReader(
      {
        bindings: [],
        guards: [],
        structuredCells: [
          {
            csvPath: SOURCE,
            column: "rewards",
            targetPath: TARGET,
            split: "colon",
            cast: "int",
            part: 0,
            entrySeparator: "semicolon",
          },
        ],
      },
      [
        {
          id: "o1",
          kind: "pin-row-key",
          target: { csvPath: TARGET },
          value: "id",
          createdAt: "2026-01-01",
        },
      ],
    );
    const findings = byRule(
      checks(
        [
          { path: TARGET, source: ITEM_TABLE },
          { path: SOURCE, source: SOURCE_BEFORE },
        ],
        [
          { path: TARGET, source: ITEM_TABLE },
          { path: SOURCE, source: "id,rewards\nL1,100:2;999:1\nL2,200:1;100:4\n" },
        ],
        { profile },
      ),
      "REF-02",
    );
    expect(findings).toHaveLength(1);
    const finding = firstFinding(findings);
    expect(finding.message).toContain("1 cell(s)");
    expect(finding.message).toContain('"999:1"');
    expect(finding.message).toContain('entry (split ";")');
    expect(finding.derivation.some((step) => step.includes("every entry"))).toBe(true);
  });
});

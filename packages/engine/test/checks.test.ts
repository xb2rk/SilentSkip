import type { ProjectProfile } from "@craftland-qa/contracts";
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
} from "@craftland-qa/engine";
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

/** Minimal profile carrying one `pin-binding` override. */
function profileWithPin(csvPath: string, value: string): ProjectProfile {
  return {
    projectId: "p1",
    conventions: [],
    readApiFamily: [],
    overrides: [
      { id: "o1", kind: "pin-binding", target: { csvPath }, value, createdAt: "2026-01-01" },
    ],
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
        { profile: profileWithPin(TABLE_PATH, "id") },
      ),
      "STRUCT-02",
    );
    const finding = firstFinding(findings);
    expect(finding.confidence).toBe("exact");
    expect(finding.message).not.toContain("pin the row-key column");
    expect(finding.derivation[0]).toContain('pinned to column "id"');
  });

  it("reports a pinned key column that does not exist in the header", () => {
    const findings = byRule(
      checks(
        [{ path: TABLE_PATH, source: TABLE_CLEAN }],
        [{ path: TABLE_PATH, source: "id,atk\nscout,120\nguard,80\n" }],
        { profile: profileWithPin(TABLE_PATH, "nope") },
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
  it("reports empty, duplicate, whitespace and unicode header names", () => {
    const after = "id, atk,atk,,V\u1ec7t\n1,2,3,4,5\n";
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
    expect(finding.message).toContain("1 non-ASCII name(s)");
    // Header row plus four witness cells.
    expect(finding.anchors).toHaveLength(5);
    expect(finding.anchors[0]).toBe(`B:${TABLE_PATH}:1:1:csv`);
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

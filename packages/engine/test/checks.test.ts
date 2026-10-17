import {
  buildDeltaBundle,
  buildFactBundle,
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
) {
  return runChecks({
    base: sideOf("A", before),
    current: sideOf("B", after),
    delta: buildDeltaBundle({ before, after }),
    registerAnchor: REGISTER,
  });
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

    expect(findings).toHaveLength(1);
    const finding = firstFinding(findings);
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
      checks(
        [{ path: TABLE_PATH, source: TABLE_CLEAN }],
        [{ path: TABLE_PATH, source: "id,atk\nscout,120\nguard,80\n" }],
      ),
    ).toEqual([]);
    expect(
      checks(
        [{ path: TABLE_PATH, source: TABLE_CLEAN }],
        [{ path: TABLE_PATH, source: TABLE_CLEAN }],
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

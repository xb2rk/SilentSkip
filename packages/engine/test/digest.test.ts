import { readFileSync } from "node:fs";
import {
  DigestBundleSchema,
  emptyProjectProfile,
  type ProjectProfile,
} from "@silentskip/contracts";
import { describe, expect, it } from "vitest";
import { buildDigest, type DigestInput } from "../src/index.js";

const FCG_BEFORE = `import "Strings.fcc" as Strings
static graph Config {
  _MOD int = 104729
  /** Damage formula multiplier. */
  func Damage(base int) int {
    return base * _MOD
  }
  func Removed() int {
    return 1
  }
}
`;

const FCG_AFTER = `import "Strings.fcc" as Strings
static graph Config {
  _MOD int = 104730
  /** Damage formula multiplier. */
  func Damage(base int) int {
    return base * _MOD + 1
  }
  func Added() int {
    return 2
  }
  func UseDamage() int {
    return Damage(10)
  }
}
`;

const CSV_BEFORE = "id,atk\nscout,100\nranger,50\n";
const CSV_AFTER = "id,atk\nscout,120\nranger,50\nguard,80\n";

const SCRIPT_PATH = "Assets/Scripts/Config.fcg";
const TABLE_PATH = "Assets/CSV/UnitData.csv";

function input(extra: Partial<DigestInput> = {}): DigestInput {
  return {
    base: {
      ref: "main",
      commitHash: "a".repeat(40),
      sources: [
        { path: SCRIPT_PATH, source: FCG_BEFORE },
        { path: TABLE_PATH, source: CSV_BEFORE },
      ],
    },
    current: {
      ref: "WORKTREE",
      commitHash: null,
      sources: [
        { path: SCRIPT_PATH, source: FCG_AFTER },
        { path: TABLE_PATH, source: CSV_AFTER },
      ],
    },
    ...extra,
  };
}

describe("buildDigest", () => {
  it("produces a schema-valid digest that is deterministic", () => {
    const digest = buildDigest(input());
    expect(DigestBundleSchema.parse(digest)).toEqual(digest);
    expect(buildDigest(input())).toEqual(digest);
    expect(digest.refs.base.ref).toBe("main");
    expect(digest.refs.current.ref).toBe("WORKTREE");
    expect(digest.refs.current.commitHash).toBeNull();
  });

  it("records exact script change facts with symbol deltas", () => {
    const digest = buildDigest(input());
    const script = digest.changeFacts.find((fact) => fact.kind === "script");
    expect(script?.status).toBe("changed");
    expect(script?.symbolsAdded.map((symbol) => symbol.name).sort()).toEqual([
      "Added",
      "UseDamage",
    ]);
    expect(script?.symbolsRemoved.map((symbol) => symbol.name)).toEqual(["Removed"]);
    expect(script?.symbolsChanged.map((symbol) => symbol.name).sort()).toEqual(["Damage", "_MOD"]);
    expect(digest.stats.scriptFilesChanged).toBe(1);
    expect(digest.stats.symbolsChanged).toBe(2);
  });

  it("records exact table change facts with cell values and column names", () => {
    const digest = buildDigest(input());
    const table = digest.changeFacts.find((fact) => fact.kind === "table");
    expect(table?.status).toBe("changed");
    expect(table?.rowsAdded.map((row) => row.key)).toEqual(["guard"]);
    const changed = table?.rowsChanged[0];
    expect(changed?.key).toBe("scout");
    expect(changed?.keyKind).toBe("first-column");
    expect(changed?.columnsChanged).toHaveLength(1);
    expect(changed?.columnsChanged[0]?.column).toBe("atk");
    expect(changed?.columnsChanged[0]?.before).toBe("100");
    expect(changed?.columnsChanged[0]?.after).toBe("120");
    expect(digest.stats.rowsAdded).toBe(1);
    expect(digest.stats.rowsChanged).toBe(1);
  });

  it("anchors every item in raw-faithful spans with a git blob sha", () => {
    const digest = buildDigest(input());
    const baseSources = new Map(input().base.sources.map((source) => [source.path, source.source]));
    const currentSources = new Map(
      input().current.sources.map((source) => [source.path, source.source]),
    );
    expect(digest.anchors.length).toBeGreaterThan(0);
    for (const anchor of digest.anchors) {
      const source = (anchor.ref === "A" ? baseSources : currentSources).get(anchor.file);
      if (source === undefined) throw new Error(`anchor file not in sources: ${anchor.file}`);
      const lines = source.split(/\r?\n/u);
      const span = lines.slice(anchor.lineStart - 1, anchor.lineEnd).join("\n");
      expect(span).toContain(anchor.snippet);
      expect(anchor.blobSha).toHaveLength(40);
    }
  });

  it("walks journeys for changed symbols on the current side", () => {
    const digest = buildDigest(input());
    const damage = digest.linked.find((item) => item.originLabel === "Damage");
    expect(damage).toBeDefined();
    expect(damage?.originKind).toBe("symbol");
    expect(damage?.anchorId).not.toBeNull();
    const labels = (damage?.chains ?? []).flatMap((chain) => chain.nodes.map((node) => node.label));
    expect(labels).toContain("UseDamage");
    const callSite = (damage?.chains ?? [])
      .flatMap((chain) => chain.nodes)
      .find((node) => node.nodeKind === "call-site");
    expect(callSite?.confidence).toBe("inferred");
  });

  it("notes dead values honestly instead of inventing paths", () => {
    const digest = buildDigest(input());
    const tableRow = digest.linked.find((item) => item.originLabel === `${TABLE_PATH}#scout`);
    expect(tableRow).toBeDefined();
    expect(tableRow?.chains).toEqual([]);
    expect(tableRow?.note).toContain("Consider pinning");
  });

  it("attaches doc comments of changed symbols as context", () => {
    const digest = buildDigest(input());
    expect(
      digest.context.some(
        (item) => item.itemKind === "doc-comment" && item.text.includes("Damage formula"),
      ),
    ).toBe(true);
  });

  it("respects the journey budget and reports selection honestly", () => {
    const digest = buildDigest(input({ budgets: { maxJourneys: 1 } }));
    expect(digest.linked).toHaveLength(1);
    expect(digest.manifest.selection.journeyCandidates).toBeGreaterThan(1);
    expect(digest.manifest.selection.journeysSelected).toBe(1);
    expect(digest.manifest.budgets.maxJourneys).toBe(1);
  });

  it("caps journeys per file and fills the remaining budget from capped-out candidates", () => {
    const functions = (value: (index: number) => number): string =>
      Array.from(
        { length: 12 },
        (_, index) => `  func F${index}() int {\n    return ${value(index)}\n  }`,
      ).join("\n");
    const before = `static graph Big {\n${functions(() => 0)}\n}\n`;
    const after = `static graph Big {\n${functions((index) => index + 1)}\n}\n`;
    const digest = buildDigest(
      input({
        base: {
          ref: "main",
          commitHash: "a".repeat(40),
          sources: [{ path: SCRIPT_PATH, source: before }],
        },
        current: {
          ref: "WORKTREE",
          commitHash: null,
          sources: [{ path: SCRIPT_PATH, source: after }],
        },
        budgets: { maxJourneys: 6 },
      }),
    );
    // 12 changed symbols in one file: the per-file cap keeps 4, the fill pass tops up to the budget.
    expect(digest.linked).toHaveLength(6);
  });

  it("includes pinned profile material as context", () => {
    const profile: ProjectProfile = {
      ...emptyProjectProfile("p1", "2026-01-01T00:00:00.000Z"),
      conventions: [
        {
          id: "c1",
          kind: "binding",
          statement: "CSV accessed via CSVIndex enum",
          evidence: [],
          source: "user",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    const digest = buildDigest(input({ profile }));
    expect(
      digest.context.some(
        (item) => item.itemKind === "convention" && item.text.includes("CSVIndex"),
      ),
    ).toBe(true);
  });

  it("lists removed tables without journeys and notes it", () => {
    const digest = buildDigest({
      ...input(),
      base: {
        ref: "main",
        commitHash: "a".repeat(40),
        sources: [
          { path: SCRIPT_PATH, source: FCG_BEFORE },
          { path: TABLE_PATH, source: CSV_BEFORE },
          { path: "Assets/CSV/Old.csv", source: "id,v\nA,1\n" },
        ],
      },
    });
    const removed = digest.changeFacts.find(
      (fact) => fact.kind === "table" && fact.status === "removed",
    );
    if (removed === undefined || removed.kind !== "table") {
      throw new Error("expected a removed table change fact");
    }
    expect(removed.rowsRemoved.map((row) => row.key)).toEqual(["A"]);
    expect(digest.manifest.notes.some((note) => note.includes("Removed origins"))).toBe(true);
  });

  it("builds a valid digest from checked-in fixtures", () => {
    const textHash = readFileSync(
      new URL("../../fc-lang/test/fixtures/Utils/Math.fcg", import.meta.url),
      "utf8",
    );
    const unitData = readFileSync(new URL("./fixtures/csv/UnitData.csv", import.meta.url), "utf8");
    const digest = buildDigest({
      base: {
        ref: "main",
        commitHash: "b".repeat(40),
        sources: [
          { path: "Assets/Scripts/Utils/TextHash.fcg", source: textHash },
          { path: "Assets/CSV/UnitData.csv", source: unitData },
        ],
      },
      current: {
        ref: "WORKTREE",
        commitHash: null,
        sources: [
          {
            path: "Assets/Scripts/Utils/TextHash.fcg",
            source: textHash.replaceAll("104729", "999983"),
          },
          { path: "Assets/CSV/UnitData.csv", source: `${unitData.replace(/\r?\n$/u, "")},999\n` },
        ],
      },
    });
    expect(DigestBundleSchema.parse(digest)).toEqual(digest);
    const script = digest.changeFacts.find((fact) => fact.kind === "script");
    expect(script?.symbolsChanged.map((symbol) => symbol.name)).toEqual(["_MOD"]);
    const table = digest.changeFacts.find((fact) => fact.kind === "table");
    expect((table?.rowsChanged.length ?? 0) + (table?.rowsAdded.length ?? 0)).toBe(1);
  });
});

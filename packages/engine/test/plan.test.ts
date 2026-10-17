import { buildReadingPlan, type PlanInput, type ReadingPlan } from "@craftland-qa/engine";
import { describe, expect, it } from "vitest";

/**
 * Reading-plan gate: units must cover every changed file exactly once, keep every changed
 * name/value (lossless compaction), respect the byte budget without splitting files, and the
 * base partition must be a true partition of the changed set — the properties the AI flow
 * (E7.2) and the partition validator rely on.
 */

const A = "Assets/Scripts/A.fcg";
const B = "Assets/Scripts/B.fcg";
const T = "Assets/CSV/T.csv";
/** Code-unit path order — the same comparison the plan uses (`Assets/CSV` sorts first). */
const ALL_PATHS = [T, A, B];

const INPUT: PlanInput = {
  scripts: [
    {
      path: A,
      status: "changed",
      language: "fcg",
      importsAdded: ["Strings.fcc"],
      importsRemoved: [],
      symbolsAdded: [],
      symbolsRemoved: [],
      symbolsChanged: [
        { name: "_MOD", kind: "field", beforeValue: "104729", afterValue: "999983" },
      ],
    },
    {
      path: B,
      status: "added",
      language: "fcg",
      importsAdded: [],
      importsRemoved: [],
      symbolsAdded: [{ name: "NewGun", kind: "function" }],
      symbolsRemoved: [],
      symbolsChanged: [],
    },
  ],
  tables: [
    {
      path: T,
      status: "changed",
      headerChanged: false,
      beforeColumns: 2,
      afterColumns: 2,
      rowsAdded: ["guard"],
      rowsRemoved: [],
      rowsChanged: [{ key: "scout", cells: [{ column: "atk", before: "100", after: "120" }] }],
    },
  ],
  graphEdges: [
    { from: A, to: B },
    { from: A, to: B },
    { from: B, to: B },
  ],
};

function coveredPaths(plan: ReadingPlan): string[] {
  return plan.units.flatMap((unit) => unit.files).sort();
}

function partitionPaths(plan: ReadingPlan): string[] {
  return plan.partition.clusters.flatMap((cluster) => cluster.files).sort();
}

describe("reading plan", () => {
  it("covers every changed file exactly once across units and keeps payloads lossless", () => {
    const plan = buildReadingPlan(INPUT);

    expect(coveredPaths(plan)).toEqual(ALL_PATHS);
    expect(new Set(coveredPaths(plan)).size).toBe(ALL_PATHS.length);
    expect(plan.units.map((unit) => unit.index)).toEqual(plan.units.map((_, index) => index));

    for (const unit of plan.units) {
      const parsed = JSON.parse(unit.payload) as { path: string }[];
      expect(parsed.map((entry) => entry.path)).toEqual(unit.files);
      expect(unit.estimatedBytes).toBe(Buffer.byteLength(unit.payload, "utf8"));
    }

    const payload = plan.units.map((unit) => unit.payload).join("");
    for (const fragment of ["_MOD", "104729", "999983", "NewGun", "scout", "120", "guard"]) {
      expect(payload).toContain(fragment);
    }
  });

  it("builds a true partition grouped by import edges and directories", () => {
    const plan = buildReadingPlan(INPUT);

    expect(partitionPaths(plan)).toEqual(ALL_PATHS);
    expect(new Set(partitionPaths(plan)).size).toBe(ALL_PATHS.length);
    expect(plan.partition.clusters.map((cluster) => cluster.files)).toEqual([[A, B], [T]]);
    expect(plan.partition.clusters.map((cluster) => cluster.id)).toEqual([
      "cluster-1",
      "cluster-2",
    ]);
  });

  it("maps the change surface in the skeleton", () => {
    const plan = buildReadingPlan(INPUT);

    expect(plan.skeleton.files.map((file) => file.path)).toEqual(ALL_PATHS);
    const tableEntry = plan.skeleton.files[0];
    if (tableEntry === undefined) throw new Error("expected a table skeleton entry");
    expect(tableEntry.kind).toBe("table");
    expect(tableEntry.headerColumns).toBe(2);
    const scriptEntry = plan.skeleton.files[1];
    if (scriptEntry === undefined) throw new Error("expected a script skeleton entry");
    expect(scriptEntry.counts).toEqual({ added: 0, removed: 0, changed: 1 });
    expect(scriptEntry.changedSymbols).toEqual(["_MOD"]);
    expect(scriptEntry.headerColumns).toBeNull();
    // Duplicate and self edges are dropped; the real edge survives.
    expect(plan.skeleton.importEdges).toEqual([{ from: A, to: B }]);
  });

  it("packs units under the byte budget without splitting files", () => {
    const tiny = buildReadingPlan({ ...INPUT, unitBudgetBytes: 10 });
    expect(tiny.units.map((unit) => unit.files.length)).toEqual([1, 1, 1]);

    const huge = buildReadingPlan({ ...INPUT, unitBudgetBytes: 1_000_000 });
    expect(huge.units).toHaveLength(1);
    expect(huge.units[0]?.files).toEqual(ALL_PATHS);
  });

  it("is deterministic", () => {
    expect(buildReadingPlan(INPUT)).toEqual(buildReadingPlan(INPUT));
  });
});

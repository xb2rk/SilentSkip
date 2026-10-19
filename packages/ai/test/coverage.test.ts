import { describe, expect, it } from "vitest";
import { MAX_COVERAGE_UNITS, selectCoverageTargets } from "../src/index";

/**
 * Phase 7 locks the L1 coverage budget here, away from the pipeline: which units get a second
 * reading pass, in what order, and what the cap may never drop.
 */

const ANCHOR_FILES = new Map([
  ["a1", "Assets/Scripts/A.fcg"],
  ["a2", "Assets/CSV/B.csv"],
  ["a3", "Assets/CSV/C.csv"],
  ["a4", "Assets/CSV/D.csv"],
]);

interface TestUnit {
  readonly index: number;
  readonly files: readonly string[];
}

function unit(index: number, files: string[]): TestUnit {
  return { index, files };
}

function finding(...anchors: string[]): { anchors: string[] } {
  return { anchors };
}

const UNITS: readonly TestUnit[] = [
  unit(0, ["Assets/Scripts/A.fcg"]),
  unit(1, ["Assets/CSV/B.csv"]),
  unit(2, ["Assets/CSV/C.csv"]),
  unit(3, ["Assets/CSV/D.csv"]),
];

function indicesOf(retryUnits: number[], unaddressed: { anchors: string[] }[]): number[] {
  return selectCoverageTargets({
    units: UNITS,
    retryUnits: new Set(retryUnits),
    unaddressed,
    anchorFiles: ANCHOR_FILES,
  }).map((target) => target.index);
}

describe("selectCoverageTargets", () => {
  it("ignores units that merely answered with nothing to report", () => {
    expect(indicesOf([], [])).toEqual([]);
  });

  it("re-reads the units owning uninterpreted engine findings, lowest index first", () => {
    expect(indicesOf([], [finding("a3"), finding("a2")])).toEqual([1, 2]);
  });

  it("caps the re-reads and keeps the worst case", () => {
    expect(MAX_COVERAGE_UNITS).toBe(2);
    // Unit 1 owns two of the findings, units 2 and 3 one each: unit 1 goes first, then unit 2 wins
    // the tie against unit 3 on index — unit 3's finding is left to the unknowns instead.
    expect(indicesOf([], [finding("a2", "a3"), finding("a2"), finding("a4")])).toEqual([1, 2]);
  });

  it("never drops a unit whose reading never arrived, whatever the cap says", () => {
    expect(indicesOf([0, 2, 3], [finding("a2")])).toEqual([0, 1, 2, 3]);
  });

  it("does not spend cap slots on units already re-read for a missing reading", () => {
    // Units 1 and 2 are retried anyway, so their findings must not hold two of the two cap slots —
    // that would leave unit 3 unreachable.
    expect(indicesOf([1, 2], [finding("a2"), finding("a3"), finding("a4")])).toEqual([1, 2, 3]);
  });
});

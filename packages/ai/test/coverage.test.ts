import { describe, expect, it } from "vitest";
import { selectCoverageTargets } from "../src/index";

/**
 * L1 coverage budget: only units whose reading never arrived get a second pass, in unit order.
 * Engine findings are deterministic facts that travel straight to synthesize — no AI round is
 * spent chasing a model citation for something the engine already proved.
 */

interface TestUnit {
  readonly index: number;
  readonly files: readonly string[];
}

const UNITS: readonly TestUnit[] = [
  { index: 0, files: ["Assets/Scripts/A.fcg"] },
  { index: 1, files: ["Assets/CSV/B.csv"] },
  { index: 2, files: ["Assets/CSV/C.csv"] },
  { index: 3, files: ["Assets/CSV/D.csv"] },
];

function indicesOf(retryUnits: number[]): number[] {
  return selectCoverageTargets({ units: UNITS, retryUnits: new Set(retryUnits) }).map(
    (target) => target.index,
  );
}

describe("selectCoverageTargets", () => {
  it("returns nothing when every reading arrived", () => {
    expect(indicesOf([])).toEqual([]);
  });

  it("re-reads exactly the units whose reading never arrived, in unit order", () => {
    expect(indicesOf([3, 0])).toEqual([0, 3]);
    expect(indicesOf([1, 2])).toEqual([1, 2]);
  });
});

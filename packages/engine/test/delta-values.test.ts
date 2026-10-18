import { buildDeltaBundle, type SymbolChange } from "@silentskip/engine";
import { describe, expect, it } from "vitest";

/**
 * Delta v2 gate: changed symbols carry the raw literal initializers from both sides when they
 * exist (`beforeValue`/`afterValue`) and honestly omit them otherwise — values are the primary
 * payload of the multi-call reading flow, so absence must mean "no single-literal initializer",
 * never "lost".
 */

const FCG_PATH = "Assets/Scripts/C.fcg";
const FCG_BEFORE = [
  "static graph C {",
  "  _MOD int = 104729",
  "",
  "  func Dmg(base int) int {",
  "    return base * _MOD",
  "  }",
  "}",
  "",
].join("\n");
const FCG_AFTER = [
  "static graph C {",
  "  _MOD int = 999983",
  "",
  "  func Dmg(base int) int {",
  "    return (base * _MOD) + 1",
  "  }",
  "}",
  "",
].join("\n");

const FCC_PATH = "Assets/Scripts/Flags.fcc";
const FCC_BEFORE = ["enum Flags {", "  On = 1", "  Off = 2", "}", ""].join("\n");
const FCC_AFTER = ["enum Flags {", "  On = 1", "  Off = 3", "}", ""].join("\n");

function changeNamed(changes: readonly SymbolChange[], name: string): SymbolChange {
  const change = changes.find((entry) => entry.name === name);
  if (change === undefined) throw new Error(`expected a changed symbol named ${name}`);
  return change;
}

describe("delta literal values", () => {
  it("records before/after literal values on changed symbols", () => {
    const bundle = buildDeltaBundle({
      before: [
        { path: FCG_PATH, source: FCG_BEFORE },
        { path: FCC_PATH, source: FCC_BEFORE },
      ],
      after: [
        { path: FCG_PATH, source: FCG_AFTER },
        { path: FCC_PATH, source: FCC_AFTER },
      ],
    });

    expect(bundle.scripts.map((script) => script.path)).toEqual([FCG_PATH, FCC_PATH]);

    const fcg = bundle.scripts.find((script) => script.path === FCG_PATH);
    if (fcg === undefined) throw new Error("expected the FCG script delta");
    const mod = changeNamed(fcg.symbolsChanged, "_MOD");
    expect(mod.beforeValue).toBe("104729");
    expect(mod.afterValue).toBe("999983");

    // A function body change has no single-literal initializer — values must be absent.
    const dmg = changeNamed(fcg.symbolsChanged, "Dmg");
    expect(dmg.beforeValue).toBeUndefined();
    expect(dmg.afterValue).toBeUndefined();

    const fcc = bundle.scripts.find((script) => script.path === FCC_PATH);
    if (fcc === undefined) throw new Error("expected the FCC script delta");
    const off = changeNamed(fcc.symbolsChanged, "Off");
    expect(off.kind).toBe("enum-member");
    expect(off.beforeValue).toBe("2");
    expect(off.afterValue).toBe("3");
  });

  it("is deterministic", () => {
    const before = [{ path: FCG_PATH, source: FCG_BEFORE }];
    const after = [{ path: FCG_PATH, source: FCG_AFTER }];
    expect(buildDeltaBundle({ before, after })).toEqual(buildDeltaBundle({ before, after }));
  });
});

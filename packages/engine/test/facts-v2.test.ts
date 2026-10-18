import { buildFactBundle } from "@silentskip/engine";
import { describe, expect, it } from "vitest";

/**
 * Facts v2 gate: literal `ValueFact`s (raw, symbol-bound, single-literal initializers only) and
 * `ComparisonFact`s (raw syntax of guard comparisons) — the fact families that let the AI flow
 * and the link-verifier talk about numbers through fact ids instead of free text.
 */

const PATH = "Assets/Scripts/Guards.fcg";
const SOURCE = [
  "static graph Guards {",
  "  _LIMIT int = 10",
  "",
  "  func Check(n int) bool {",
  "    var floor int = 3",
  "    if n >= _LIMIT {",
  "      return true",
  "    }",
  "    return n == floor",
  "  }",
  "}",
  "",
].join("\n");

describe("facts v2", () => {
  it("records raw literal values bound to their declaring symbols", () => {
    const bundle = buildFactBundle([{ path: PATH, source: SOURCE }]);
    const file = bundle.files[0];
    if (file === undefined) throw new Error("expected one fact file");

    expect(file.values).toHaveLength(2);
    const [limit, floor] = file.values;
    if (limit === undefined || floor === undefined) throw new Error("expected two value facts");
    expect(limit.text).toBe("10");
    expect(limit.rawText).toBe("10");
    expect(limit.symbolId.startsWith(`${PATH}#_LIMIT@`)).toBe(true);
    expect(SOURCE.slice(limit.span.offset, limit.span.offset + limit.span.length)).toBe("10");
    expect(floor.text).toBe("3");
    expect(floor.symbolId.startsWith(`${PATH}#floor@`)).toBe(true);
  });

  it("records raw comparison facts with faithful left/right spans", () => {
    const bundle = buildFactBundle([{ path: PATH, source: SOURCE }]);
    const file = bundle.files[0];
    if (file === undefined) throw new Error("expected one fact file");

    expect(file.comparisons).toHaveLength(2);
    const guard = file.comparisons[0];
    if (guard === undefined) throw new Error("expected the guard comparison");
    expect(guard.operatorText).toBe(">=");
    expect(guard.leftText).toBe("n");
    expect(guard.rightText).toBe("_LIMIT");
    expect(guard.container).toBe("Check");
    expect(SOURCE.slice(guard.leftSpan.offset, guard.leftSpan.offset + guard.leftSpan.length)).toBe(
      "n",
    );
    expect(
      SOURCE.slice(guard.rightSpan.offset, guard.rightSpan.offset + guard.rightSpan.length),
    ).toBe("_LIMIT");

    const equality = file.comparisons[1];
    if (equality === undefined) throw new Error("expected the equality comparison");
    expect(equality.operatorText).toBe("==");
    expect(equality.leftText).toBe("n");
    expect(equality.rightText).toBe("floor");
  });

  it("is deterministic", () => {
    expect(buildFactBundle([{ path: PATH, source: SOURCE }])).toEqual(
      buildFactBundle([{ path: PATH, source: SOURCE }]),
    );
  });
});

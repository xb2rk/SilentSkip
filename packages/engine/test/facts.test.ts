import { buildFactBundle, type FileFacts } from "@silentskip/engine";
import { describe, expect, it } from "vitest";

/**
 * Engineered fixtures for the fact walkers. Sources use only constructs verified against the
 * checked-in fixtures (real syntax), so a parse diagnostic here means the walker or fixture is
 * wrong — never the grammar.
 */

const FCC_SOURCE = `import "List.fcc" as List

/**
  Shared combat vocabulary for the sample project.
*/
enum Element {
  // No element.
  None = 0
  Fire = 1
  Water = 2
}

/**
  Base stats for one unit species.
*/
tuple UnitStats {
  // Base attack damage before modifiers.
  BaseATK int = 1
  CritMultiplier float = 1.5
}

func GetBaseATK(id UnitId) int
`;

const FCG_SOURCE = `import "Contracts/CustomEnum.fcc" as CustomEnum
import HashString from "Utils/TextHash.fcg"

/**
  Live config for one unit species.
*/
[platform_server]
static graph UnitData {
  // Path of the CSV table backing this graph.
  _CONFIG_PATH string = "UnitData.csv"

  func CalcDamage(base int) int {
    var scaled int = Strings.Length(_CONFIG_PATH) + base
    for i = 0, 3, 1 {
      scaled = scaled + 1
    }
    if scaled > 10 {
      scaled = 10
    } else {
      scaled = 0
    }
    return scaled
  }
}
`;

/** Build facts for a single file (throws if the engine returns nothing — it never should). */
function buildOne(path: string, source: string): FileFacts {
  const file = buildFactBundle([{ path, source }]).files[0];
  if (!file) throw new Error("expected exactly one file in the bundle");
  return file;
}

/** Name-sorted projection (walk order is deterministic but not guaranteed source order). */
function sortedSymbols(file: FileFacts) {
  return file.symbols
    .map((s) => ({ name: s.name, kind: s.kind, scope: s.scope, container: s.container ?? null }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

describe("buildFactBundle — header files (.fcc)", () => {
  const file = buildOne("Contracts/Combat.fcc", FCC_SOURCE);

  it("parses cleanly and records the honest parse outcome", () => {
    expect(file.language).toBe("fcc");
    expect(file.parse.lexDiagnostics).toBe(0);
    expect(file.parse.diagnostics).toBe(0);
    expect(file.parse.consumedThroughEof).toBe(true);
  });

  it("extracts symbols with scope and container", () => {
    expect(sortedSymbols(file)).toEqual([
      { name: "BaseATK", kind: "field", scope: "member", container: "UnitStats" },
      { name: "CritMultiplier", kind: "field", scope: "member", container: "UnitStats" },
      { name: "Element", kind: "enum", scope: "top", container: null },
      { name: "Fire", kind: "enum-member", scope: "member", container: "Element" },
      { name: "GetBaseATK", kind: "function", scope: "top", container: null },
      { name: "None", kind: "enum-member", scope: "member", container: "Element" },
      { name: "UnitStats", kind: "tuple", scope: "top", container: null },
      { name: "Water", kind: "enum-member", scope: "member", container: "Element" },
      { name: "id", kind: "parameter", scope: "local", container: "GetBaseATK" },
    ]);
  });

  it("attaches doc comments (jsdoc and line) to the following declaration", () => {
    const element = file.symbols.find((s) => s.name === "Element");
    const elementDoc = file.docComments.find((d) => d.attachedTo === element?.id);
    expect(elementDoc?.kind).toBe("jsdoc");
    expect(elementDoc?.text).toContain("Shared combat vocabulary");

    const none = file.symbols.find((s) => s.name === "None");
    const noneDoc = file.docComments.find((d) => d.attachedTo === none?.id);
    expect(noneDoc?.kind).toBe("line-comment");
    expect(noneDoc?.text).toContain("No element");

    const baseAtk = file.symbols.find((s) => s.name === "BaseATK");
    const baseAtkDoc = file.docComments.find((d) => d.attachedTo === baseAtk?.id);
    expect(baseAtkDoc?.text).toContain("Base attack damage before modifiers");
  });

  it("extracts imports with path and alias", () => {
    expect(file.imports).toEqual([
      expect.objectContaining({ kind: "library", path: "List.fcc", alias: "List" }),
    ]);
  });

  it("keeps every name span raw-faithful", () => {
    for (const symbol of file.symbols) {
      expect(
        FCC_SOURCE.slice(symbol.nameSpan.offset, symbol.nameSpan.offset + symbol.nameSpan.length),
      ).toBe(symbol.name);
    }
  });
});

describe("buildFactBundle — graph files (.fcg)", () => {
  const file = buildOne("Data/UnitData.fcg", FCG_SOURCE);

  it("extracts graph members, locals and loop bindings with containers", () => {
    expect(sortedSymbols(file)).toEqual([
      { name: "CalcDamage", kind: "function", scope: "member", container: "UnitData" },
      { name: "UnitData", kind: "graph", scope: "top", container: null },
      { name: "_CONFIG_PATH", kind: "field", scope: "member", container: "UnitData" },
      { name: "base", kind: "parameter", scope: "local", container: "CalcDamage" },
      { name: "i", kind: "for-binding", scope: "local", container: "CalcDamage" },
      { name: "scaled", kind: "variable", scope: "local", container: "CalcDamage" },
    ]);
  });

  it("extracts calls with callee, receiver, arity and container", () => {
    const call = file.calls.find((c) => c.calleeText === "Strings.Length");
    expect(call).toBeDefined();
    expect(call?.calleeName).toBe("Length");
    expect(call?.receiverText).toBe("Strings");
    expect(call?.argumentCount).toBe(1);
    expect(call?.container).toBe("CalcDamage");
    expect(call?.prefix).toBeUndefined();
  });

  it("extracts string literals raw-faithfully", () => {
    const csvString = file.strings.find((s) => s.innerText === "UnitData.csv");
    expect(csvString?.rawText).toBe('"UnitData.csv"');
    expect(
      FCG_SOURCE.slice(
        csvString?.span.offset ?? 0,
        (csvString?.span.offset ?? 0) + (csvString?.span.length ?? 0),
      ),
    ).toBe('"UnitData.csv"');
  });

  it("resolves references at the name level without guessing", () => {
    const configRead = file.refs.find((r) => r.name === "_CONFIG_PATH" && r.role === "read");
    expect(configRead?.resolution).toEqual(
      expect.objectContaining({ status: "resolved", level: "member" }),
    );

    const scaledWrite = file.refs.find((r) => r.name === "scaled" && r.role === "write");
    expect(scaledWrite?.resolution).toEqual(
      expect.objectContaining({ status: "resolved", level: "local" }),
    );

    const baseRead = file.refs.find((r) => r.name === "base" && r.role === "read");
    expect(baseRead?.resolution).toEqual(
      expect.objectContaining({ status: "resolved", level: "local" }),
    );

    const external = file.refs.find((r) => r.name === "Strings" && r.role === "read");
    expect(external?.resolution).toEqual({ status: "unresolved" });
  });
});

describe("buildFactBundle — robustness", () => {
  it("captures `wait` prefixed calls", () => {
    const file = buildOne(
      "Utils/Async.fcg",
      "graph G { func F() int { wait Sleep(100) return 1 } }",
    );
    const call = file.calls.find((c) => c.calleeName === "Sleep");
    expect(call?.prefix).toBe("wait");
    expect(call?.argumentCount).toBe(1);
    expect(file.calls).toHaveLength(1);
  });

  it("returns honest parse info for broken sources instead of throwing", () => {
    const file = buildOne("Broken.fcg", "graph {");
    expect(file.parse.diagnostics).toBeGreaterThan(0);
    expect(Array.isArray(file.symbols)).toBe(true);
  });

  it("is deterministic and sorts files by path", () => {
    const forward = buildFactBundle([
      { path: "a/Z.fcg", source: FCG_SOURCE },
      { path: "a/A.fcc", source: FCC_SOURCE },
    ]);
    const backward = buildFactBundle([
      { path: "a/A.fcc", source: FCC_SOURCE },
      { path: "a/Z.fcg", source: FCG_SOURCE },
    ]);
    expect(forward.files.map((f) => f.path)).toEqual(["a/A.fcc", "a/Z.fcg"]);
    expect(forward).toEqual(backward);
  });

  it("sorts paths by code unit, not locale collation", () => {
    const bundle = buildFactBundle([
      { path: "a/b.fcg", source: FCG_SOURCE },
      { path: "a/B.fcc", source: FCC_SOURCE },
    ]);
    // Code-unit order puts "B" (0x42) before "b" (0x62); locale collation would flip these.
    expect(bundle.files.map((f) => f.path)).toEqual(["a/B.fcc", "a/b.fcg"]);
  });

  it("rejects unsupported extensions", () => {
    expect(() => buildFactBundle([{ path: "notes.txt", source: "" }])).toThrow(
      /Unsupported FC source extension/,
    );
  });
});

/**
 * Journey tests — engineered fixtures covering every expansion rule plus the
 * honesty paths (dead value, truncation, unknown origins) and determinism.
 */

import type { FactBundle, Journey, RelationSet } from "@craftland-qa/engine";
import { buildFactBundle, buildJourney, buildRelations } from "@craftland-qa/engine";
import { describe, expect, it } from "vitest";

const FCG = `import "Strings.fcc" as Strings

static graph Loader {
  _PATH string = "Data/UnitData.csv"
  _MULT int = 2
  _UNUSED int = 7

  func Load() int {
    var table string = _PATH
    return Strings.Length(table)
  }

  func Boost() int {
    return Load() * _MULT
  }
}
`;

const MULTI = `static graph Multi {
  _A string = "Data/UnitData.csv"
  _B string = "Data/UnitData.csv"
}
`;

const CSV_PATHS = ["Data/UnitData.csv"];

/** Builds the shared fixture bundle and relation set. */
function build(): { bundle: FactBundle; relations: RelationSet } {
  const bundle = buildFactBundle([{ path: "Assets/Scripts/Loader.fcg", source: FCG }]);
  const relations = buildRelations(bundle, { csvPaths: CSV_PATHS });
  return { bundle, relations };
}

/** Finds a symbol id by name or throws — keeps tests assertion-free. */
function symbolId(bundle: FactBundle, name: string): string {
  const symbol = bundle.files[0]?.symbols.find((candidate) => candidate.name === name);
  if (symbol === undefined) throw new Error(`symbol not found: ${name}`);
  return symbol.id;
}

/** Projects chains to their node kinds for compact assertions. */
function kinds(journey: Journey): string[][] {
  return journey.chains.map((chain) => chain.nodes.map((node) => node.kind));
}

/** Projects chains to their node labels for compact assertions. */
function labels(journey: Journey): string[][] {
  return journey.chains.map((chain) => chain.nodes.map((node) => node.label));
}

describe("buildJourney — csv origin", () => {
  it("walks table → naming literal → binding symbol with raw-faithful spans", () => {
    const { bundle, relations } = build();
    const journey = buildJourney({
      bundle,
      relations,
      origin: { kind: "csv", path: "Data/UnitData.csv" },
    });
    expect(kinds(journey)).toEqual([["csv-table", "string-literal", "symbol"]]);
    expect(labels(journey)).toEqual([["Data/UnitData.csv", '"Data/UnitData.csv"', "_PATH"]]);
    const nodes = journey.chains[0]?.nodes ?? [];
    expect(nodes.map((node) => node.level)).toEqual([0, 1, 2]);
    const literal = nodes[1];
    expect(literal?.confidence).toBe("exact");
    const span = literal?.span;
    if (span === undefined) throw new Error("literal span missing");
    expect(FCG.slice(span.offset, span.offset + span.length)).toBe('"Data/UnitData.csv"');
    expect(nodes[2]?.symbolId).toBe(symbolId(bundle, "_PATH"));
    expect(journey.truncated).toBe(false);
  });

  it("labels row origins", () => {
    const { bundle, relations } = build();
    const journey = buildJourney({
      bundle,
      relations,
      origin: { kind: "csv", path: "Data/UnitData.csv", rowKey: "scout" },
    });
    expect(journey.origin.label).toBe("Data/UnitData.csv#scout");
    expect(journey.origin.derivation[0]).toContain("Changed row scout");
  });

  it("reports a dead value with an explicit note", () => {
    const { bundle, relations } = build();
    const journey = buildJourney({
      bundle,
      relations,
      origin: { kind: "csv", path: "Data/Unknown.csv" },
    });
    expect(journey.chains).toEqual([]);
    expect(journey.note).toContain("Consider pinning");
  });
});

describe("buildJourney — symbol origin", () => {
  it("walks field → ref-site → runtime container", () => {
    const { bundle, relations } = build();
    const journey = buildJourney({
      bundle,
      relations,
      origin: {
        kind: "symbol",
        file: "Assets/Scripts/Loader.fcg",
        symbolId: symbolId(bundle, "_PATH"),
      },
    });
    expect(kinds(journey)).toEqual([["symbol", "ref-site", "symbol"]]);
    expect(labels(journey)).toEqual([["_PATH", "_PATH", "Load"]]);
    expect(journey.chains[0]?.nodes[1]?.confidence).toBe("inferred");
    expect(journey.chains[0]?.nodes[2]?.symbolId).toBe(symbolId(bundle, "Load"));
  });

  it("walks function → call sites → callers, skipping cycles", () => {
    const { bundle, relations } = build();
    const journey = buildJourney({
      bundle,
      relations,
      origin: {
        kind: "symbol",
        file: "Assets/Scripts/Loader.fcg",
        symbolId: symbolId(bundle, "Load"),
      },
    });
    expect(kinds(journey)).toEqual([
      ["symbol", "call-site"],
      ["symbol", "call-site", "symbol"],
    ]);
    expect(labels(journey)).toEqual([
      ["Load", "Strings.Length"],
      ["Load", "Load", "Boost"],
    ]);
    expect(journey.chains[1]?.nodes[1]?.confidence).toBe("inferred");
    expect(journey.chains[1]?.nodes[2]?.confidence).toBe("exact");
  });

  it("reports unused symbols with a note", () => {
    const { bundle, relations } = build();
    const journey = buildJourney({
      bundle,
      relations,
      origin: {
        kind: "symbol",
        file: "Assets/Scripts/Loader.fcg",
        symbolId: symbolId(bundle, "_UNUSED"),
      },
    });
    expect(journey.chains).toEqual([]);
    expect(journey.note).toContain("No use-sites found");
  });

  it("throws for unknown origin symbols", () => {
    const { bundle, relations } = build();
    expect(() =>
      buildJourney({
        bundle,
        relations,
        origin: { kind: "symbol", file: "Assets/Scripts/Loader.fcg", symbolId: "missing" },
      }),
    ).toThrow(/Unknown journey origin symbol/);
  });
});

describe("buildJourney — budget & determinism", () => {
  it("caps layers and reports truncation", () => {
    const bundle = buildFactBundle([{ path: "Multi.fcg", source: MULTI }]);
    const relations = buildRelations(bundle, { csvPaths: CSV_PATHS });
    const full = buildJourney({
      bundle,
      relations,
      origin: { kind: "csv", path: "Data/UnitData.csv" },
    });
    expect(full.chains).toHaveLength(2);
    expect(full.truncated).toBe(false);

    const capped = buildJourney({
      bundle,
      relations,
      origin: { kind: "csv", path: "Data/UnitData.csv" },
      maxNodesPerLayer: 1,
    });
    expect(capped.chains).toHaveLength(1);
    expect(capped.truncated).toBe(true);
  });

  it("is deterministic across runs", () => {
    const { bundle, relations } = build();
    const csvOrigin = { kind: "csv", path: "Data/UnitData.csv" } as const;
    expect(buildJourney({ bundle, relations, origin: csvOrigin })).toEqual(
      buildJourney({ bundle, relations, origin: csvOrigin }),
    );
    const symbolOrigin = {
      kind: "symbol",
      file: "Assets/Scripts/Loader.fcg",
      symbolId: symbolId(bundle, "Load"),
    } as const;
    expect(buildJourney({ bundle, relations, origin: symbolOrigin })).toEqual(
      buildJourney({ bundle, relations, origin: symbolOrigin }),
    );
  });
});

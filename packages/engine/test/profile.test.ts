/**
 * Discovery collector tests — deterministic candidates from proven facts and
 * relations, with raw-faithful spans and honest evidence lines.
 */

import type { FactBundle, RelationSet } from "@silentskip/engine";
import { buildFactBundle, buildRelations, collectDiscoveryCandidates } from "@silentskip/engine";
import { describe, expect, it } from "vitest";

const A = `import "Convert.fcc" as Convert
import "List.fcc" as List

static graph A {
  _PATH string = "Data/UnitData.csv"
}
`;

const B = `import "List.fcc" as List

static graph B {
  _X int = 1
}
`;

const SOLO = `static graph Solo {
  _N int = 1
}
`;

/** Builds the shared fixture bundle and relations. */
function build(): { bundle: FactBundle; relations: RelationSet } {
  const bundle = buildFactBundle([
    { path: "a.fcg", source: A },
    { path: "b.fcg", source: B },
  ]);
  const relations = buildRelations(bundle, { csvPaths: ["Data/UnitData.csv"] });
  return { bundle, relations };
}

describe("collectDiscoveryCandidates", () => {
  it("collects csv-binding and import-path candidates with evidence", () => {
    const { bundle, relations } = build();
    const candidates = collectDiscoveryCandidates(bundle, relations);
    expect(candidates.map((c) => c.kind)).toEqual(["csv-binding", "import-path", "import-path"]);
    expect(candidates.map((c) => c.file)).toEqual(["a.fcg", "a.fcg", "a.fcg"]);

    const csvCandidate = candidates.find((c) => c.kind === "csv-binding");
    const span = csvCandidate?.span;
    if (span === undefined) throw new Error("csv-binding span missing");
    expect(A.slice(span.offset, span.offset + span.length)).toBe('"Data/UnitData.csv"');
    expect(csvCandidate?.file).toBe("a.fcg");
    expect(csvCandidate?.evidence.at(-1)).toBe("names Data/UnitData.csv");

    const listCandidate = candidates.find((c) => c.id === "import-path|List.fcc");
    expect(listCandidate?.evidence[0]).toBe("imported by 2 file(s)");
    expect(listCandidate?.file).toBe("a.fcg");

    const convertCandidate = candidates.find((c) => c.id === "import-path|Convert.fcc");
    expect(convertCandidate?.evidence[0]).toBe("imported by 1 file(s)");
  });

  it("is deterministic across runs", () => {
    const { bundle, relations } = build();
    expect(collectDiscoveryCandidates(bundle, relations)).toEqual(
      collectDiscoveryCandidates(bundle, relations),
    );
  });

  it("returns an empty list when nothing is proven", () => {
    const bundle = buildFactBundle([{ path: "solo.fcg", source: SOLO }]);
    const relations = buildRelations(bundle, { csvPaths: [] });
    expect(collectDiscoveryCandidates(bundle, relations)).toEqual([]);
  });
});

import {
  buildFactBundle,
  buildRelations,
  type FactBundle,
  type Relation,
} from "@craftland-qa/engine";
import { describe, expect, it } from "vitest";

/**
 * Engineered fixtures for the relation builder. Sources use only constructs verified against
 * the checked-in corpus; a parse diagnostic here means a fixture is wrong, never the grammar.
 */

const LIST_FCC = `import "StdLibrary.fcc" as StdLibrary

/**
  Gameplay element ids.
*/
enum Element {
  None = 0
  Fire = 1
}

func GetBaseATK(id int) int
`;

const PLANT_DATA_FCG = `import "../Contracts/List.fcc" as List
import "Strings.fcc" as Strings
import HashString from "../Utils/TextHash.fcg"

/**
  Live config.
*/
[platform_server]
static graph UnitData {
  // Path of the CSV table backing this graph.
  _CONFIG_PATH string = "UnitData.csv"
  // Secondary table.
  _OTHER string = "Other.csv"
  // A table that is not part of the project.
  _MISSING string = "Unknown.csv"

  func Helper() int {
    return 1
  }

  func CalcDamage(base int) int {
    var scaled int = Strings.Length(_CONFIG_PATH) + base
    scaled = scaled + Helper()
    var cb int = 0
    scaled = scaled + cb(1)
    return scaled
  }
}
`;

const TEXT_HASH_FCG = `static graph TextHash {
  func HashString(input string) int {
    return Strings.Length(input)
  }
}
`;

const CSV_PATHS = ["Assets/CSV/UnitData.csv", "Assets/CSV/Other.csv"];

function buildFixtureBundle(): FactBundle {
  return buildFactBundle([
    { path: "Contracts/List.fcc", source: LIST_FCC },
    { path: "Data/UnitData.fcg", source: PLANT_DATA_FCG },
    { path: "Utils/TextHash.fcg", source: TEXT_HASH_FCG },
  ]);
}

function buildFixtureRelations(): Relation[] {
  return buildRelations(buildFixtureBundle(), { csvPaths: CSV_PATHS }).relations;
}

function importIdOf(bundle: FactBundle, filePath: string, importPath: string): string {
  const file = bundle.files.find((f) => f.path === filePath);
  const imp = file?.imports.find((i) => i.path === importPath);
  if (!imp) throw new Error(`import not found: ${filePath} -> ${importPath}`);
  return imp.id;
}

describe("buildRelations — refers_to", () => {
  const bundle = buildFixtureBundle();
  const relations = buildRelations(bundle, { csvPaths: CSV_PATHS }).relations;

  it("marks same-container local references exact", () => {
    const baseRead = relations.find(
      (r) => r.ruleId === "name-refers-to-symbol" && r.to.symbolId?.includes("#base@") === true,
    );
    expect(baseRead?.confidence).toBe("exact");
    expect(baseRead?.from.file).toBe("Data/UnitData.fcg");
    expect(baseRead?.derivation.length).toBeGreaterThanOrEqual(3);
  });

  it("marks cross-container member fallback inferred (honest, never guessed as exact)", () => {
    const configRead = relations.find(
      (r) =>
        r.ruleId === "name-refers-to-symbol" && r.to.symbolId?.includes("#_CONFIG_PATH@") === true,
    );
    expect(configRead?.confidence).toBe("inferred");
    expect(configRead?.derivation.some((step) => step.includes("any container"))).toBe(true);
  });

  it("links references resolved to an import", () => {
    const stringsImportId = importIdOf(bundle, "Data/UnitData.fcg", "Strings.fcc");
    const stringsRef = relations.find(
      (r) => r.ruleId === "name-refers-to-import" && r.to.importId === stringsImportId,
    );
    expect(stringsRef?.confidence).toBe("inferred");
  });

  it("produces no relation for unresolved names (GetBaseATK lives in another file)", () => {
    const unresolvedCall = relations.find(
      (r) =>
        r.ruleId === "call-name-resolves" &&
        r.derivation.some((step) => step.includes("GetBaseATK")),
    );
    expect(unresolvedCall).toBeUndefined();
  });
});

describe("buildRelations — calls", () => {
  const bundle = buildFixtureBundle();
  const relations = buildRelations(bundle, { csvPaths: CSV_PATHS }).relations;

  it("links a member call receiver to its import (inferred)", () => {
    const stringsImportId = importIdOf(bundle, "Data/UnitData.fcg", "Strings.fcc");
    const receiverCall = relations.find(
      (r) => r.ruleId === "call-receiver-import" && r.to.importId === stringsImportId,
    );
    expect(receiverCall?.confidence).toBe("inferred");
    expect(receiverCall?.derivation.some((step) => step.includes("Strings.Length"))).toBe(true);
  });

  it("resolves a bare graph-sibling call as member-any inferred", () => {
    const helperCall = relations.find(
      (r) => r.ruleId === "call-name-resolves" && r.to.symbolId?.includes("#Helper@") === true,
    );
    expect(helperCall?.confidence).toBe("inferred");
  });

  it("marks a local callee exact", () => {
    const localCall = relations.find(
      (r) => r.ruleId === "call-name-resolves" && r.to.symbolId?.includes("#cb@") === true,
    );
    expect(localCall?.confidence).toBe("exact");
  });
});

describe("buildRelations — imports", () => {
  const bundle = buildFixtureBundle();
  const relations = buildRelations(bundle, { csvPaths: CSV_PATHS }).relations;

  it("records every import statement as an exact literal fact", () => {
    const statements = relations.filter((r) => r.ruleId === "import-statement");
    expect(statements).toHaveLength(4);
    expect(statements.every((r) => r.confidence === "exact")).toBe(true);
  });

  it("resolves relative import paths against the bundle", () => {
    const listImport = relations.find(
      (r) => r.ruleId === "import-path-matches-file" && r.to.file === "Contracts/List.fcc",
    );
    expect(listImport?.confidence).toBe("inferred");
    expect(listImport?.derivation.some((step) => step.includes("relative"))).toBe(true);
  });

  it("resolves suffix matches when relative resolution fails", () => {
    const relationsWithSuffix = buildRelations(
      buildFactBundle([
        { path: "Contracts/List.fcc", source: LIST_FCC },
        {
          path: "Data/Importer.fcg",
          source: `import "List.fcc" as List\n\nstatic graph Importer {\n}\n`,
        },
      ]),
      {},
    ).relations;
    const suffixMatch = relationsWithSuffix.find((r) => r.ruleId === "import-path-matches-file");
    expect(suffixMatch?.to.file).toBe("Contracts/List.fcc");
    expect(suffixMatch?.derivation.some((step) => step.includes("suffix"))).toBe(true);
  });

  it("stays silent when the path matches more than one file", () => {
    const relationsAmbiguous = buildRelations(
      buildFactBundle([
        { path: "A/List.fcc", source: LIST_FCC },
        { path: "B/List.fcc", source: LIST_FCC },
        {
          path: "Data/Importer.fcg",
          source: `import "List.fcc" as List\n\nstatic graph Importer {\n}\n`,
        },
      ]),
      {},
    ).relations;
    expect(relationsAmbiguous.some((r) => r.ruleId === "import-path-matches-file")).toBe(false);
  });
});

describe("buildRelations — names_csv", () => {
  const relations = buildFixtureRelations();

  it("links a literal filename to exactly one CSV table (exact)", () => {
    const plantCsv = relations.find(
      (r) => r.ruleId === "string-names-csv" && r.to.file === "Assets/CSV/UnitData.csv",
    );
    expect(plantCsv?.confidence).toBe("exact");
    expect(plantCsv?.from.file).toBe("Data/UnitData.fcg");
  });

  it("produces no relation for a filename with no match", () => {
    const missing = relations.find(
      (r) =>
        r.ruleId === "string-names-csv" &&
        r.derivation.some((step) => step.includes("Unknown.csv")),
    );
    expect(missing).toBeUndefined();
  });
});

describe("buildRelations — determinism", () => {
  it("is deterministic and sorted by id", () => {
    const bundle = buildFixtureBundle();
    const first = buildRelations(bundle, { csvPaths: CSV_PATHS });
    const second = buildRelations(bundle, { csvPaths: CSV_PATHS });
    expect(first).toEqual(second);
    const ids = first.relations.map((r) => r.id);
    expect([...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(ids);
  });
});

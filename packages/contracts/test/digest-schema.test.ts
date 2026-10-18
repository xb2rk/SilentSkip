import { describe, expect, it } from "vitest";
import { AnchorSchema, DigestBundleSchema } from "../src/index";

const BLOB_SHA = "1f3c9a2b4d5e6f708192a3b4c5d6e7f8091a2b3c";

const ANCHOR = {
  id: "A:Assets/CSV/UnitData.csv:12:12:csv:r:scout:c:BaseATK",
  ref: "A",
  file: "Assets/CSV/UnitData.csv",
  blobSha: BLOB_SHA,
  lineStart: 12,
  lineEnd: 12,
  snippet: "scout,100,25",
  loc: { rowKey: "scout", column: "BaseATK" },
  kind: "csv",
};

const EMPTY_DIGEST = {
  schemaVersion: 4,
  refs: {
    base: { ref: "HEAD~1", commitHash: "a".repeat(40) },
    current: { ref: "WORKTREE", commitHash: null },
  },
  stats: {
    filesChanged: 0,
    scriptFilesChanged: 0,
    tableFilesChanged: 0,
    symbolsAdded: 0,
    symbolsRemoved: 0,
    symbolsChanged: 0,
    rowsAdded: 0,
    rowsRemoved: 0,
    rowsChanged: 0,
  },
  changeFacts: [],
  linked: [],
  context: [],
  quantities: [],
  findings: [],
  surfaces: {
    base: { ref: "A", entries: [], truncated: 0 },
    current: { ref: "B", entries: [], truncated: 0 },
    delta: { newSilent: [], fixed: [], unchanged: [] },
    detectedMechanisms: [],
    note: "No silent-skip effects.",
  },
  bodies: [],
  plan: {
    units: [],
    skeleton: { files: [], importEdges: [] },
    partition: { clusters: [] },
  },
  anchors: [],
  manifest: {
    budgets: { maxJourneys: 12, maxAnchors: 500 },
    counts: {
      changedScripts: 0,
      changedTables: 0,
      anchors: 0,
      journeys: 0,
      contextItems: 0,
      bodies: 0,
      bodiesTruncated: 0,
    },
    selection: { journeyCandidates: 0, journeysSelected: 0, anchorsDropped: 0 },
    notes: [],
  },
};

describe("anchor schema", () => {
  it("round-trips a full csv anchor with loc", () => {
    expect(AnchorSchema.parse(ANCHOR)).toEqual(ANCHOR);
  });

  it("rejects malformed anchors", () => {
    expect(() => AnchorSchema.parse({ ...ANCHOR, ref: "C" })).toThrow();
    expect(() => AnchorSchema.parse({ ...ANCHOR, lineStart: 0 })).toThrow();
    expect(() => AnchorSchema.parse({ ...ANCHOR, kind: "prose" })).toThrow();
  });
});

describe("digest bundle schema", () => {
  it("round-trips an empty digest", () => {
    expect(DigestBundleSchema.parse(EMPTY_DIGEST)).toEqual(EMPTY_DIGEST);
  });

  it("round-trips a digest with a script change, a linked journey and context", () => {
    const digest = {
      ...EMPTY_DIGEST,
      stats: {
        ...EMPTY_DIGEST.stats,
        filesChanged: 1,
        scriptFilesChanged: 1,
        symbolsChanged: 1,
      },
      changeFacts: [
        {
          kind: "script",
          path: "Assets/Scripts/Config.fcg",
          status: "changed",
          language: "fcg",
          symbolsAdded: [],
          symbolsRemoved: [],
          symbolsChanged: [
            {
              name: "_MOD",
              symbolKind: "field",
              beforeAnchorId: ANCHOR.id,
              afterAnchorId: ANCHOR.id,
            },
          ],
          importsAdded: [],
          importsRemoved: [],
        },
      ],
      linked: [
        {
          originKind: "symbol",
          originLabel: "_MOD",
          anchorId: ANCHOR.id,
          chains: [
            {
              nodes: [
                { label: "_MOD", nodeKind: "symbol", confidence: "exact", anchorId: ANCHOR.id },
                {
                  label: "Damage",
                  nodeKind: "ref-site",
                  confidence: "inferred",
                  anchorId: ANCHOR.id,
                },
              ],
            },
          ],
        },
      ],
      context: [
        {
          itemKind: "convention",
          text: "binding: CSV via CSVIndex enum",
          source: "profile",
          anchorId: null,
        },
      ],
      anchors: [ANCHOR],
      manifest: {
        ...EMPTY_DIGEST.manifest,
        counts: {
          changedScripts: 1,
          changedTables: 0,
          anchors: 1,
          journeys: 1,
          contextItems: 1,
          bodies: 0,
          bodiesTruncated: 0,
        },
      },
    };
    expect(DigestBundleSchema.parse(digest)).toEqual(digest);
  });

  it("rejects malformed digests", () => {
    expect(() => DigestBundleSchema.parse({ ...EMPTY_DIGEST, schemaVersion: 0 })).toThrow();
    expect(() =>
      DigestBundleSchema.parse({
        ...EMPTY_DIGEST,
        changeFacts: [{ kind: "script", path: "x", status: "moved" }],
      }),
    ).toThrow();
  });

  it("round-trips engine findings, quantities and a reading plan", () => {
    const tableFact = {
      kind: "table",
      path: "Assets/CSV/UnitData.csv",
      status: "changed",
      headerChanged: false,
      columns: { before: 2, after: 2 },
      widths: {
        before: [
          { width: 2, rows: 1 },
          { width: 3, rows: 1 },
        ],
        after: [{ width: 2, rows: 1 }],
      },
      rowsAdded: [],
      rowsRemoved: [],
      rowsChanged: [],
    };
    const digest = {
      ...EMPTY_DIGEST,
      changeFacts: [tableFact],
      quantities: [
        {
          id: "q:column-count|B|Assets/CSV/UnitData.csv",
          kind: "column-count",
          subject: "Assets/CSV/UnitData.csv columns (after)",
          value: "2",
          ref: "B",
          anchorId: ANCHOR.id,
          file: "Assets/CSV/UnitData.csv",
        },
      ],
      findings: [
        {
          id: "STRUCT-01|A|Assets/CSV/UnitData.csv",
          ruleId: "STRUCT-01",
          severity: "major",
          confidence: "exact",
          title: "Row width differs from the header",
          message: "1 of 2 data rows differ.",
          anchors: [ANCHOR.id],
          derivation: ["Header cell count: 2."],
        },
      ],
      plan: {
        units: [
          {
            index: 0,
            files: ["Assets/CSV/UnitData.csv"],
            estimatedBytes: 120,
            payload: '[{"path":"Assets/CSV/UnitData.csv"}]',
          },
        ],
        skeleton: {
          files: [
            {
              path: "Assets/CSV/UnitData.csv",
              kind: "table",
              status: "changed",
              counts: { added: 0, removed: 0, changed: 0 },
              changedSymbols: [],
              headerColumns: 2,
            },
          ],
          importEdges: [],
        },
        partition: { clusters: [{ id: "cluster-1", files: ["Assets/CSV/UnitData.csv"] }] },
      },
    };
    expect(DigestBundleSchema.parse(digest)).toEqual(digest);
    expect(() =>
      DigestBundleSchema.parse({
        ...digest,
        findings: [{ ...digest.findings[0], severity: "blocker" }],
      }),
    ).toThrow();
  });
});

import type { DigestBundle } from "@craftland-qa/contracts";

/**
 * A small hand-built digest fixture for pass/pipeline tests.
 *
 * Shape mirrors a real digest: one changed script symbol (`_MOD`), one changed CSV cell
 * (`scout.atk`), one journey chain and one pinned convention — enough to exercise
 * evidence packing, query resolution and structured-findings merging without any engine call.
 */

export const ANCHOR_A_MOD = "A:Assets/Scripts/Config.fcg:2:2:code";
export const ANCHOR_B_MOD = "B:Assets/Scripts/Config.fcg:2:2:code";
export const ANCHOR_A_ATK = "A:Assets/CSV/UnitData.csv:2:2:csv:r:scout:c:atk";
export const ANCHOR_B_ATK = "B:Assets/CSV/UnitData.csv:2:2:csv:r:scout:c:atk";

/** Build a fresh digest fixture (never shared/mutated between tests). */
export function makeDigest(): DigestBundle {
  return {
    schemaVersion: 2,
    refs: {
      base: { ref: "HEAD~1", commitHash: "aaaa1111" },
      current: { ref: "WORKTREE", commitHash: null },
    },
    stats: {
      filesChanged: 2,
      scriptFilesChanged: 1,
      tableFilesChanged: 1,
      symbolsAdded: 0,
      symbolsRemoved: 0,
      symbolsChanged: 1,
      rowsAdded: 0,
      rowsRemoved: 0,
      rowsChanged: 1,
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
            beforeAnchorId: ANCHOR_A_MOD,
            afterAnchorId: ANCHOR_B_MOD,
          },
        ],
        importsAdded: [],
        importsRemoved: [],
      },
      {
        kind: "table",
        path: "Assets/CSV/UnitData.csv",
        status: "changed",
        headerChanged: false,
        columns: { before: 2, after: 2 },
        widths: { before: [{ width: 2, rows: 1 }], after: [{ width: 2, rows: 1 }] },
        rowsAdded: [],
        rowsRemoved: [],
        rowsChanged: [
          {
            key: "scout",
            keyKind: "first-column",
            columnsChanged: [
              {
                column: "atk",
                before: "100",
                after: "120",
                beforeAnchorId: ANCHOR_A_ATK,
                afterAnchorId: ANCHOR_B_ATK,
              },
            ],
            beforeLine: 2,
            afterLine: 2,
          },
        ],
      },
    ],
    linked: [
      {
        originKind: "csv-row",
        originLabel: "Assets/CSV/UnitData.csv#scout",
        anchorId: ANCHOR_B_ATK,
        chains: [
          {
            nodes: [
              {
                label: "scout",
                nodeKind: "csv-table",
                confidence: "exact",
                anchorId: ANCHOR_B_ATK,
              },
              {
                label: "GetBaseATK",
                nodeKind: "symbol",
                confidence: "inferred",
                anchorId: ANCHOR_B_MOD,
              },
            ],
          },
        ],
      },
    ],
    context: [
      {
        itemKind: "convention",
        text: "binding: UnitData.csv rows are bound by enum index in CSVIndex.fcc",
        source: "profile",
        anchorId: null,
      },
    ],
    quantities: [
      {
        id: "q:symbol-count|B|Assets/Scripts/Config.fcg|added",
        kind: "symbol-count",
        subject: "Assets/Scripts/Config.fcg symbols added",
        value: "0",
        ref: "B",
        anchorId: null,
      },
      {
        id: "q:symbol-count|A|Assets/Scripts/Config.fcg|removed",
        kind: "symbol-count",
        subject: "Assets/Scripts/Config.fcg symbols removed",
        value: "0",
        ref: "A",
        anchorId: null,
      },
      {
        id: "q:symbol-count|Assets/Scripts/Config.fcg|changed",
        kind: "symbol-count",
        subject: "Assets/Scripts/Config.fcg symbols changed",
        value: "1",
        ref: null,
        anchorId: null,
      },
      {
        id: "q:value|A|Assets/Scripts/Config.fcg|_MOD",
        kind: "value",
        subject: "Assets/Scripts/Config.fcg _MOD (before)",
        value: "104729",
        ref: "A",
        anchorId: ANCHOR_A_MOD,
      },
      {
        id: "q:value|B|Assets/Scripts/Config.fcg|_MOD",
        kind: "value",
        subject: "Assets/Scripts/Config.fcg _MOD (after)",
        value: "999983",
        ref: "B",
        anchorId: ANCHOR_B_MOD,
      },
    ],
    findings: [],
    plan: {
      units: [],
      skeleton: { files: [], importEdges: [] },
      partition: { clusters: [] },
    },
    anchors: [
      {
        id: ANCHOR_A_MOD,
        ref: "A",
        file: "Assets/Scripts/Config.fcg",
        blobSha: "0123456789abcdef0123456789abcdef01234567",
        lineStart: 2,
        lineEnd: 2,
        snippet: "_MOD int = 104729",
        kind: "code",
      },
      {
        id: ANCHOR_B_MOD,
        ref: "B",
        file: "Assets/Scripts/Config.fcg",
        blobSha: "0123456789abcdef0123456789abcdef01234567",
        lineStart: 2,
        lineEnd: 2,
        snippet: "_MOD int = 999983",
        kind: "code",
      },
      {
        id: ANCHOR_A_ATK,
        ref: "A",
        file: "Assets/CSV/UnitData.csv",
        blobSha: "abcdef0123456789abcdef0123456789abcdef01",
        lineStart: 2,
        lineEnd: 2,
        snippet: "scout,100",
        kind: "csv",
        loc: { rowKey: "scout", column: "atk" },
      },
      {
        id: ANCHOR_B_ATK,
        ref: "B",
        file: "Assets/CSV/UnitData.csv",
        blobSha: "abcdef0123456789abcdef0123456789abcdef01",
        lineStart: 2,
        lineEnd: 2,
        snippet: "scout,120",
        kind: "csv",
        loc: { rowKey: "scout", column: "atk" },
      },
    ],
    manifest: {
      budgets: { maxJourneys: 12, maxAnchors: 500 },
      counts: { changedScripts: 1, changedTables: 1, anchors: 4, journeys: 1, contextItems: 1 },
      selection: { journeyCandidates: 1, journeysSelected: 1, anchorsDropped: 0 },
      notes: [],
    },
  };
}

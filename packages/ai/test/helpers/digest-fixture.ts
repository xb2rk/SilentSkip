import type { DigestBundle } from "@silentskip/contracts";

/**
 * The digest fixture of the AI test suite (v2): two changed files — a script whose `_MOD`
 * constant changed and a CSV whose `scout.atk` cell changed — with quantities, one engine
 * finding, a two-unit reading plan and four anchors. Everything the v2 flow needs to exercise
 * map/read/dig/synthesize plus the linker.
 */

/** Anchor ids used across the AI test suite — real digest format. */
export const ANCHOR_A_MOD = "A:Assets/Scripts/Config.fcg:2:2:code";
export const ANCHOR_B_MOD = "B:Assets/Scripts/Config.fcg:2:2:code";
export const ANCHOR_A_ATK = "A:Assets/CSV/UnitData.csv:2:2:csv:r:scout:c:atk";
export const ANCHOR_B_ATK = "B:Assets/CSV/UnitData.csv:2:2:csv:r:scout:c:atk";

/** Paths of the two changed files. */
export const SCRIPT_PATH = "Assets/Scripts/Config.fcg";
export const TABLE_PATH = "Assets/CSV/UnitData.csv";

/** Id of the engine finding the reading flow must interpret. */
export const ENGINE_FINDING_ID = "STRUCT-01|B|Assets/CSV/UnitData.csv";

const BLOB_SHA = "0000000000000000000000000000000000000000";

/** Fresh digest fixture — every call returns a new object so tests can mutate freely. */
export function makeDigest(): DigestBundle {
  return {
    schemaVersion: 4,
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
        path: SCRIPT_PATH,
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
            beforeValue: "104729",
            afterValue: "999983",
          },
        ],
        importsAdded: [],
        importsRemoved: [],
      },
      {
        kind: "table",
        path: TABLE_PATH,
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
        originLabel: `${TABLE_PATH}#scout`,
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
        text: "UnitData.csv rows are bound by an index enum in a header file",
        source: "profile",
        anchorId: null,
      },
    ],
    quantities: [
      {
        id: `q:symbol-count|B|${SCRIPT_PATH}|added`,
        kind: "symbol-count",
        subject: `${SCRIPT_PATH} added symbols`,
        value: "0",
        ref: "B",
        anchorId: null,
        file: SCRIPT_PATH,
      },
      {
        id: `q:symbol-count|A|${SCRIPT_PATH}|removed`,
        kind: "symbol-count",
        subject: `${SCRIPT_PATH} removed symbols`,
        value: "0",
        ref: "A",
        anchorId: null,
        file: SCRIPT_PATH,
      },
      {
        id: `q:symbol-count|${SCRIPT_PATH}|changed`,
        kind: "symbol-count",
        subject: `${SCRIPT_PATH} changed symbols`,
        value: "1",
        ref: null,
        anchorId: null,
        file: SCRIPT_PATH,
      },
      {
        id: `q:value|A|${SCRIPT_PATH}|_MOD`,
        kind: "value",
        subject: "_MOD (before)",
        value: "104729",
        ref: "A",
        anchorId: ANCHOR_A_MOD,
        file: SCRIPT_PATH,
      },
      {
        id: `q:value|B|${SCRIPT_PATH}|_MOD`,
        kind: "value",
        subject: "_MOD (after)",
        value: "999983",
        ref: "B",
        anchorId: ANCHOR_B_MOD,
        file: SCRIPT_PATH,
      },
      {
        id: `q:column-count|A|${TABLE_PATH}`,
        kind: "column-count",
        subject: `${TABLE_PATH} columns (before)`,
        value: "2",
        ref: "A",
        anchorId: null,
        file: TABLE_PATH,
      },
      {
        id: `q:column-count|B|${TABLE_PATH}`,
        kind: "column-count",
        subject: `${TABLE_PATH} columns (after)`,
        value: "2",
        ref: "B",
        anchorId: null,
        file: TABLE_PATH,
      },
    ],
    findings: [
      {
        id: ENGINE_FINDING_ID,
        ruleId: "STRUCT-01",
        severity: "major",
        confidence: "exact",
        title: "Row width differs from the header",
        message: `1 of 1 data rows in ${TABLE_PATH} (side B) differ from the header.`,
        anchors: [ANCHOR_A_ATK, ANCHOR_B_ATK],
        derivation: ["Header cell count on side B: 2."],
      },
    ],
    surfaces: {
      base: { ref: "A", entries: [], truncated: 0 },
      current: { ref: "B", entries: [], truncated: 0 },
      delta: { newSilent: [], fixed: [], unchanged: [] },
      detectedMechanisms: [],
      note: "Fixture: no silent-skip effects.",
    },
    bodies: [
      {
        file: SCRIPT_PATH,
        symbolId: `${SCRIPT_PATH}#Recompute@64`,
        name: "Recompute",
        kind: "function",
        side: "B",
        lineStart: 4,
        lineEnd: 6,
        truncated: false,
        text: "func Recompute() int {\n    return _MOD\n  }",
      },
    ],
    plan: {
      units: [
        {
          index: 0,
          files: [SCRIPT_PATH],
          estimatedBytes: 140,
          payload: JSON.stringify([
            {
              path: SCRIPT_PATH,
              status: "changed",
              language: "fcg",
              symbolsChanged: [
                { name: "_MOD", kind: "field", beforeValue: "104729", afterValue: "999983" },
              ],
            },
          ]),
        },
        {
          index: 1,
          files: [TABLE_PATH],
          estimatedBytes: 120,
          payload: JSON.stringify([
            {
              path: TABLE_PATH,
              status: "changed",
              rowsChanged: [
                { key: "scout", cells: [{ column: "atk", before: "100", after: "120" }] },
              ],
            },
          ]),
        },
      ],
      skeleton: {
        files: [
          {
            path: SCRIPT_PATH,
            kind: "script",
            status: "changed",
            language: "fcg",
            counts: { added: 0, removed: 0, changed: 1 },
            changedSymbols: ["_MOD"],
            headerColumns: null,
          },
          {
            path: TABLE_PATH,
            kind: "table",
            status: "changed",
            counts: { added: 0, removed: 0, changed: 1 },
            changedSymbols: [],
            headerColumns: 2,
          },
        ],
        importEdges: [],
      },
      partition: {
        clusters: [
          { id: "cluster-1", files: [SCRIPT_PATH] },
          { id: "cluster-2", files: [TABLE_PATH] },
        ],
      },
    },
    anchors: [
      {
        id: ANCHOR_A_MOD,
        ref: "A",
        file: SCRIPT_PATH,
        blobSha: BLOB_SHA,
        lineStart: 2,
        lineEnd: 2,
        snippet: "_MOD int = 104729",
        kind: "code",
      },
      {
        id: ANCHOR_B_MOD,
        ref: "B",
        file: SCRIPT_PATH,
        blobSha: BLOB_SHA,
        lineStart: 2,
        lineEnd: 2,
        snippet: "_MOD int = 999983",
        kind: "code",
      },
      {
        id: ANCHOR_A_ATK,
        ref: "A",
        file: TABLE_PATH,
        blobSha: BLOB_SHA,
        lineStart: 2,
        lineEnd: 2,
        snippet: "scout,100",
        loc: { rowKey: "scout", column: "atk" },
        kind: "csv",
      },
      {
        id: ANCHOR_B_ATK,
        ref: "B",
        file: TABLE_PATH,
        blobSha: BLOB_SHA,
        lineStart: 2,
        lineEnd: 2,
        snippet: "scout,120",
        loc: { rowKey: "scout", column: "atk" },
        kind: "csv",
      },
    ],
    manifest: {
      budgets: { maxJourneys: 60, maxAnchors: 500 },
      counts: {
        changedScripts: 1,
        changedTables: 1,
        anchors: 4,
        journeys: 1,
        contextItems: 1,
        bodies: 1,
        bodiesTruncated: 0,
      },
      selection: { journeyCandidates: 1, journeysSelected: 1, anchorsDropped: 0 },
      notes: [],
    },
  };
}

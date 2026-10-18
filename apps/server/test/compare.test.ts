import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ReviewCompareResponseSchema,
  type SilentSkipEntry,
  type SilentSkipSurface,
  SurfaceHistoryResponseSchema,
} from "@silentskip/contracts";
import { migrateDatabase, openDatabase, runs } from "@silentskip/db";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const ZERO_STATS = {
  findingsChecked: 0,
  findingsStripped: 0,
  anchorsChecked: 0,
  anchorsStripped: 0,
  numbersChecked: 0,
  numbersUnverified: 0,
  quotesChecked: 0,
  quotesUnverified: 0,
  confidenceDowngraded: 0,
};

function entry(id: string, table: string, rowKey: string, column: string | null): SilentSkipEntry {
  return {
    id,
    ref: "B",
    table,
    rowKey,
    column,
    mechanism: "parse_fail",
    effect: "defaulted",
    confidence: "exact",
    detail: "value does not parse",
    anchors: [],
  };
}

function surface(entries: readonly SilentSkipEntry[]): SilentSkipSurface {
  return {
    base: { ref: "A", entries: [], truncated: 0 },
    current: { ref: "B", entries: [...entries], truncated: 0 },
    delta: { newSilent: [...entries], fixed: [], unchanged: [] },
    detectedMechanisms: ["parse_fail"],
    note: "Observed mechanisms: parse_fail.",
  };
}

function finding(id: string, severity: "major" | "info" = "major") {
  return {
    id,
    ruleId: "TYPE-01",
    severity,
    confidence: "exact",
    title: "Type mismatch",
    message: "cell fails declared type",
    anchors: [],
    derivation: ["type row compared per cell"],
  };
}

function resultJson(options: {
  readonly findings: ReturnType<typeof finding>[];
  readonly surfaces: SilentSkipSurface | null;
}): string {
  return JSON.stringify({
    report: {
      verdict: "needs_review",
      qualityScore: 80,
      executiveSummary: "Summary",
      topConcerns: [],
      themes: [],
      findings: [],
      recommendedTests: [],
      unknowns: [],
    },
    passes: [],
    themes: [],
    verification: { read: ZERO_STATS, dig: null, synthesize: ZERO_STATS, issues: [] },
    contextManifest: {
      counts: { changeFacts: 0, linked: 0, contextItems: 0, evidence: 0, evidenceDropped: 0 },
      notes: [],
    },
    engineFindings: options.findings,
    surfaces: options.surfaces,
    fallbackReason: null,
  });
}

describe("run compare + surface history", () => {
  let workspace = "";
  let app: ReturnType<typeof createApp>;
  let projectId = "";
  const leftId = "run-left";
  const rightId = "run-right";
  const legacyId = "run-legacy";

  beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), "cqa-compare-"));
    const db = openDatabase(":memory:");
    migrateDatabase(db);
    app = createApp({ db, log: pino({ level: "silent" }) });
    const response = await app.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rootPath: workspace, name: "Compare" }),
    });
    const project = (await response.json()) as { id: string };
    projectId = project.id;

    const shared = entry("Assets/CSV/T.csv|Pea|parse_fail|atk", "Assets/CSV/T.csv", "Pea", "atk");
    const onlyRight = entry(
      "Assets/CSV/T.csv|guard|parse_fail|atk",
      "Assets/CSV/T.csv",
      "guard",
      "atk",
    );
    db.insert(runs)
      .values([
        {
          id: leftId,
          projectId,
          baseRef: "A",
          currentRef: "B",
          status: "completed",
          verdict: "needs_review",
          qualityScore: 80,
          reportJson: resultJson({
            findings: [finding("TYPE-01|B|T.csv")],
            surfaces: surface([shared]),
          }),
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          completedAt: new Date("2026-01-01T00:01:00.000Z"),
        },
        {
          id: rightId,
          projectId,
          baseRef: "A",
          currentRef: "B",
          status: "completed",
          verdict: "pass_with_warnings",
          qualityScore: 90,
          reportJson: resultJson({
            findings: [finding("TYPE-01|B|T.csv"), finding("STRUCT-01|B|T.csv", "info")],
            surfaces: surface([shared, onlyRight]),
          }),
          createdAt: new Date("2026-01-02T00:00:00.000Z"),
          completedAt: new Date("2026-01-02T00:01:00.000Z"),
        },
        {
          id: legacyId,
          projectId,
          baseRef: "A",
          currentRef: "B",
          status: "completed",
          verdict: "needs_review",
          qualityScore: 70,
          reportJson: JSON.stringify({
            report: {
              verdict: "needs_review",
              qualityScore: 70,
              executiveSummary: "Legacy",
              topConcerns: [],
              themes: [],
              findings: [],
              recommendedTests: [],
              unknowns: [],
            },
            passes: [],
            themes: [],
            verification: { read: ZERO_STATS, dig: null, synthesize: ZERO_STATS, issues: [] },
            contextManifest: {
              counts: {
                changeFacts: 0,
                linked: 0,
                contextItems: 0,
                evidence: 0,
                evidenceDropped: 0,
              },
              notes: [],
            },
            fallbackReason: null,
          }),
          createdAt: new Date("2025-12-31T00:00:00.000Z"),
          completedAt: new Date("2025-12-31T00:01:00.000Z"),
        },
      ])
      .run();
  });

  afterAll(() => {
    if (workspace !== "") {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("compares engine findings and surfaces between two runs", async () => {
    const response = await app.request(`/api/reviews/compare?left=${leftId}&right=${rightId}`);
    expect(response.status).toBe(200);
    const body = ReviewCompareResponseSchema.parse(await response.json());
    expect(body.left.engineFindingsAvailable).toBe(true);
    expect(body.right.engineFindingsAvailable).toBe(true);
    expect(body.left.findingsCount).toBe(0);
    expect(body.engineFindings).toHaveLength(2);
    const shared = body.engineFindings.find((item) => item.id === "TYPE-01|B|T.csv");
    expect(shared?.inLeft).toBe(true);
    expect(shared?.inRight).toBe(true);
    const onlyRight = body.engineFindings.find((item) => item.id === "STRUCT-01|B|T.csv");
    expect(onlyRight?.inLeft).toBe(false);
    expect(onlyRight?.inRight).toBe(true);
    const sharedSurface = body.surfaces.find((item) => item.rowKey === "Pea");
    expect(sharedSurface?.inLeft).toBe(true);
    expect(sharedSurface?.inRight).toBe(true);
    const surfaceOnlyRight = body.surfaces.find((item) => item.rowKey === "guard");
    expect(surfaceOnlyRight?.inLeft).toBe(false);
    expect(surfaceOnlyRight?.inRight).toBe(true);
  });

  it("flags legacy runs without engine data instead of pretending empty", async () => {
    const response = await app.request(`/api/reviews/compare?left=${leftId}&right=${legacyId}`);
    const body = ReviewCompareResponseSchema.parse(await response.json());
    expect(body.right.engineFindingsAvailable).toBe(false);
    expect(body.right.surfacesAvailable).toBe(false);
    expect(body.note).toContain("E9");
  });

  it("rejects compare without both ids", async () => {
    const response = await app.request("/api/reviews/compare?left=run-left");
    expect(response.status).toBe(400);
  });

  it("lists surface history and skips legacy runs", async () => {
    const response = await app.request(`/api/projects/${projectId}/surface-history`);
    expect(response.status).toBe(200);
    const body = SurfaceHistoryResponseSchema.parse(await response.json());
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]?.runId).toBe(rightId);
    expect(body.entries[0]?.newSilent).toBe(2);
    expect(body.entries[1]?.runId).toBe(leftId);
    expect(body.skippedLegacy).toBe(1);
  });
});

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AiError, type WorkflowRunner } from "@craftland-qa/ai";
import {
  ErrorEnvelopeSchema,
  ProjectSummarySchema,
  type RunDetailResponse,
  RunDetailResponseSchema,
  RunListResponseSchema,
  StartReviewResponseSchema,
} from "@craftland-qa/contracts";
import { contextManifests, migrateDatabase, openDatabase, runs } from "@craftland-qa/db";
import { serve } from "@hono/node-server";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const FCG_BEFORE = `static graph Config {
  _MOD int = 104729
  func Damage(base int) int {
    return base * _MOD
  }
}
`;
const FCG_AFTER = FCG_BEFORE.replace("104729", "999983");
const CSV_BEFORE = "id,atk\nscout,100\n";
const CSV_AFTER = "id,atk\nscout,120\n";

function git(cwd: string, args: string[]): void {
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
    cwd,
    stdio: "pipe",
  });
}

const app = (() => {
  const db = openDatabase(":memory:");
  migrateDatabase(db);
  const instance = createApp({
    db,
    log: pino({ level: "silent" }),
    ai: {
      runner: (request) => currentRunner(request),
      config: { workflowUrl: "http://insea.test", apiKey: "test" },
    },
  });
  return { instance, db };
})();

/** Runner the tests switch per case — the app always delegates to the current one. */
let currentRunner: WorkflowRunner = () => {
  throw new Error("runner not configured for this test");
};

/** Anchors the scripted read pass cited — synthesize must reuse one (no new anchors allowed). */
let scriptedReadAnchors: string[] = [];

const scriptedRunner: WorkflowRunner = async (request) => {
  const stage = (JSON.parse(request.manifestJson) as { stage: string }).stage;
  const anchorsFile = request.attachments.find((item) => item.uploadName === "anchors.jsonl");
  const firstAnchor = JSON.parse(anchorsFile?.content.split("\n")[0] ?? "{}") as { id: string };
  const ok = (output: Record<string, unknown>) => ({
    output,
    rawResult: "{}",
    salvage: "clean" as const,
    latencyMs: 5,
  });
  if (stage === "map") {
    return ok({
      themes: [
        { name: "Script", files: ["f1"] },
        { name: "Data", files: ["f2"] },
      ],
    });
  }
  if (stage === "read") {
    const unitFile = request.attachments.find((item) => item.uploadName === "unit.json");
    const unit = JSON.parse(unitFile?.content ?? "{}") as { files?: string[] };
    const file = unit.files?.[0] ?? "";
    const factsFile = request.attachments.find((item) => item.uploadName === "facts.json");
    const facts = JSON.parse(factsFile?.content ?? "{}") as {
      quantities?: { anchorId?: string | null }[];
      engineFindings?: { anchors?: string[] }[];
    };
    // Cite everything the pass can see, so the L1 coverage loop has nothing to chase.
    scriptedReadAnchors = [
      ...new Set([
        ...(facts.quantities ?? [])
          .map((quantity) => quantity.anchorId)
          .filter((anchorId): anchorId is string => anchorId != null),
        ...(facts.engineFindings ?? []).flatMap((finding) => finding.anchors ?? []),
      ]),
    ];
    return ok({
      findings: [
        {
          title: "Change under review",
          statement: `${file} changed`,
          anchors: scriptedReadAnchors.length > 0 ? scriptedReadAnchors : [firstAnchor.id],
          severity: "minor",
          confidence: "exact",
          claims: [],
        },
      ],
      unknowns: [],
      negativeResults: [],
      needMore: [],
    });
  }
  if (stage === "synthesize") {
    return ok({
      verdict: "needs_review",
      qualityScore: 80,
      executiveSummary: "Config and table changed.",
      topConcerns: ["check _MOD"],
      themes: [
        {
          themeId: "theme-1",
          summary: "Script files changed.",
          behaviorChange: "The config graph was updated.",
          watchFor: "Skill behavior.",
          anchorIds: scriptedReadAnchors.length > 0 ? scriptedReadAnchors : [firstAnchor.id],
        },
        {
          themeId: "theme-2",
          summary: "Data table changed.",
          behaviorChange: "Row values were updated.",
          watchFor: "Combat numbers.",
          anchorIds: scriptedReadAnchors.length > 0 ? scriptedReadAnchors : [firstAnchor.id],
        },
      ],
      findings: [
        {
          title: "Config change",
          statement: "_MOD constant changed",
          anchors: [scriptedReadAnchors[0] ?? firstAnchor.id],
          severity: "minor",
          confidence: "exact",
          claims: [],
        },
      ],
      recommendedTests: ["run damage calc"],
      unknowns: [],
    });
  }
  throw new Error(`unexpected stage: ${stage}`);
};

/** Hangs until the run is cancelled, then reports cancellation like the real client. */
const hangingRunner: WorkflowRunner = async (request) => {
  if (request.signal?.aborted === true) {
    throw new AiError("cancelled", "request was cancelled");
  }
  return await new Promise((_resolve, reject) => {
    request.signal?.addEventListener(
      "abort",
      () => reject(new AiError("cancelled", "request was cancelled")),
      { once: true },
    );
  });
};

const fallbackRunner: WorkflowRunner = () => {
  throw new AiError("not-configured", "workflow URL or API key is missing");
};

let root = "";
let projectId = "";
let server: ReturnType<typeof serve>;
let baseUrl = "";

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "cqa-reviews-"));
  mkdirSync(join(root, "Assets", "Scripts"), { recursive: true });
  mkdirSync(join(root, "Assets", "CSV"), { recursive: true });
  writeFileSync(join(root, "Assets", "Scripts", "Config.fcg"), FCG_BEFORE);
  writeFileSync(join(root, "Assets", "CSV", "UnitData.csv"), CSV_BEFORE);
  git(root, ["init"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", "base"]);
  writeFileSync(join(root, "Assets", "Scripts", "Config.fcg"), FCG_AFTER);
  writeFileSync(join(root, "Assets", "CSV", "UnitData.csv"), CSV_AFTER);

  const res = await app.instance.request("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rootPath: root }),
  });
  projectId = ProjectSummarySchema.parse(await res.json()).id;

  baseUrl = await new Promise<string>((resolve) => {
    server = serve({ fetch: app.instance.fetch, hostname: "127.0.0.1", port: 0 }, (info) =>
      resolve(`http://127.0.0.1:${info.port}`),
    );
  });
});

afterAll(() => {
  server.close();
});

async function startRun(body: Record<string, unknown>): Promise<string> {
  const res = await app.instance.request("/api/reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(202);
  return StartReviewResponseSchema.parse(await res.json()).runId;
}

async function getRun(runId: string): Promise<RunDetailResponse> {
  const res = await app.instance.request(`/api/reviews/${runId}`);
  expect(res.status).toBe(200);
  return RunDetailResponseSchema.parse(await res.json());
}

async function waitForStatus(runId: string, status: string): Promise<RunDetailResponse> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const detail = await getRun(runId);
    if (detail.status === status) return detail;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`run ${runId} never reached status ${status}`);
}

async function readStream(runId: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/reviews/${runId}/stream`);
  expect(res.status).toBe(200);
  return await res.text();
}

describe("review runs", () => {
  it("runs the pipeline, persists run + manifests, and streams stage events", async () => {
    currentRunner = scriptedRunner;
    const runId = await startRun({ projectId, baseRef: "HEAD", currentRef: "WORKTREE" });

    const stream = await readStream(runId);
    expect(stream).toContain("event: stage");
    expect(stream).toContain('"stage":"digest"');
    expect(stream).toContain('"stage":"map"');
    expect(stream).toContain('"stage":"read"');
    expect(stream).toContain('"stage":"synthesize"');
    expect(stream).toContain("event: completed");
    expect(stream).toContain('"findings":1');

    const detail = await waitForStatus(runId, "completed");
    expect(detail.verdict).toBe("needs_review");
    expect(detail.qualityScore).toBe(80);
    expect(detail.error).toBeNull();
    expect(detail.result?.report.findings).toHaveLength(1);
    expect(detail.result?.passes.map((meta) => meta.pass)).toEqual(["map", "read", "synthesize"]);
    expect(detail.result?.fallbackReason).toBeNull();
    expect(detail.result?.verification.read.findingsChecked).toBe(1);

    const runRows = app.db.select().from(runs).all();
    expect(runRows).toHaveLength(1);
    expect(runRows[0]?.status).toBe("completed");
    expect(runRows[0]?.durationMs).not.toBeNull();
    const manifestRows = app.db.select().from(contextManifests).all();
    expect(manifestRows.map((row) => row.passId).sort()).toEqual(["map", "read", "synthesize"]);
    expect(manifestRows.find((row) => row.passId === "map")?.promptVersion).toBe("2.1.1");
    expect(manifestRows.find((row) => row.passId === "read")?.promptVersion).toBe("2.2.1");
  });

  it("lists runs newest first, optionally filtered by project", async () => {
    currentRunner = scriptedRunner;
    const runId = await startRun({ projectId, baseRef: "HEAD", currentRef: "WORKTREE" });
    await waitForStatus(runId, "completed");

    const listRes = await app.instance.request("/api/reviews");
    expect(listRes.status).toBe(200);
    const list = RunListResponseSchema.parse(await listRes.json());
    expect(list.runs.length).toBeGreaterThanOrEqual(1);
    expect(list.runs[0]?.id).toBe(runId);

    const filteredRes = await app.instance.request(`/api/reviews?projectId=${projectId}`);
    const filtered = RunListResponseSchema.parse(await filteredRes.json());
    expect(filtered.runs.every((run) => run.projectId === projectId)).toBe(true);

    const emptyRes = await app.instance.request("/api/reviews?projectId=missing-project");
    expect(RunListResponseSchema.parse(await emptyRes.json()).runs).toEqual([]);
  });

  it("cancels a running review and replays the cancelled terminal event", async () => {
    currentRunner = hangingRunner;
    const runId = await startRun({ projectId, baseRef: "HEAD", currentRef: "WORKTREE" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    const cancelRes = await app.instance.request(`/api/reviews/${runId}/cancel`, {
      method: "POST",
    });
    expect(cancelRes.status).toBe(200);

    const detail = await waitForStatus(runId, "cancelled");
    expect(detail.error).toBe("Run cancelled by user");
    expect(detail.result).toBeNull();
    const stream = await readStream(runId);
    expect(stream).toContain("event: cancelled");
  });

  it("serves the deterministic fallback when the AI is unavailable", async () => {
    currentRunner = fallbackRunner;
    const runId = await startRun({ projectId, baseRef: "HEAD", currentRef: "WORKTREE" });
    const detail = await waitForStatus(runId, "completed");
    expect(detail.verdict).toBe("insufficient_evidence");
    expect(detail.qualityScore).toBe(0);
    expect(detail.result?.fallbackReason).toContain("not-configured");
    expect(detail.result?.passes).toEqual([]);
    expect(detail.result?.report.unknowns).toHaveLength(1);
    const stream = await readStream(runId);
    expect(stream).toContain("event: completed");
    expect(stream).toContain('"fallbackReason":"AI review unavailable (not-configured)');
  });

  it("marks the run failed when the ref range cannot be resolved", async () => {
    currentRunner = scriptedRunner;
    const runId = await startRun({
      projectId,
      baseRef: "no-such-ref",
      currentRef: "WORKTREE",
    });
    const detail = await waitForStatus(runId, "failed");
    expect(detail.error).toContain("Không tìm thấy ref");
    expect(detail.result).toBeNull();
    const stream = await readStream(runId);
    expect(stream).toContain("event: failed");
  });

  it("rejects bad input and unknown runs with the shared envelope", async () => {
    const worktreeBase = await app.instance.request("/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, baseRef: "WORKTREE", currentRef: "WORKTREE" }),
    });
    expect(worktreeBase.status).toBe(400);
    expect(ErrorEnvelopeSchema.parse(await worktreeBase.json()).error.code).toBe("BAD_REQUEST");

    const unknownProject = await app.instance.request("/api/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "nope", baseRef: "HEAD", currentRef: "WORKTREE" }),
    });
    expect(unknownProject.status).toBe(404);

    const unknownRun = await app.instance.request("/api/reviews/unknown-run");
    expect(unknownRun.status).toBe(404);
    expect(ErrorEnvelopeSchema.parse(await unknownRun.json()).error.code).toBe("NOT_FOUND");

    const cancelUnknown = await app.instance.request("/api/reviews/unknown-run/cancel", {
      method: "POST",
    });
    expect(cancelUnknown.status).toBe(404);
  });
});

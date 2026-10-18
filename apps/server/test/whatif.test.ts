import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AiError, type InseaRunRequest, type WorkflowRunner } from "@craftland-qa/ai";
import {
  ErrorEnvelopeSchema,
  PinListResponseSchema,
  PinSchema,
  ProjectSummarySchema,
  StartWhatIfSessionRequestSchema,
  type WhatIfSessionDetailResponse,
  WhatIfSessionDetailResponseSchema,
  WhatIfSessionListResponseSchema,
  type WhatIfTurn,
} from "@craftland-qa/contracts";
import { contextManifests, migrateDatabase, openDatabase, sessionLedgers } from "@craftland-qa/db";
import { serve } from "@hono/node-server";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

/**
 * E6 What-If integration tests: session lifecycle, one grounded answer per turn with the
 * linker applied, deterministic ledger, pins riding across sessions of the same comparison,
 * and honest failure turns. The Insea runner is scripted offline; the digest comes from a
 * real temp git repository.
 */

const FCG_BEFORE = "static graph Config {\n  _MOD int = 104729\n}\n";
const FCG_AFTER = "static graph Config {\n  _MOD int = 999983\n}\n";
const CSV_BEFORE = "id,atk\nscout,100\n";
const CSV_AFTER = "id,atk\nscout,120\n";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
    cwd,
    stdio: "pipe",
  });
}

let projectId = "";
let server: ReturnType<typeof serve> | undefined;
let baseUrl = "";

const pinoSilent = pino({ level: "silent" });

/** Anchors the scripted answer cites when no pin is present (filled by the first call). */
let scriptedAskAnchors: string[] = [];

/** Every request the scripted runner saw, for attachment assertions. */
const recordedCalls: InseaRunRequest[] = [];

const scriptedRunner: WorkflowRunner = async (request) => {
  recordedCalls.push(request);
  const stage = (JSON.parse(request.manifestJson) as { stage: string }).stage;
  if (stage !== "whatif") throw new Error(`unexpected stage: ${stage}`);
  const pinsAttachment = request.attachments.find((item) => item.uploadName === "pins.jsonl");
  const pinLine = pinsAttachment?.content.split("\n")[0] ?? "";
  const firstPin =
    pinLine === "" ? undefined : (JSON.parse(pinLine) as { anchorId?: string }).anchorId;
  if (firstPin === undefined && scriptedAskAnchors.length === 0) {
    const factsAttachment = request.attachments.find((item) => item.uploadName === "facts.json");
    const facts = JSON.parse(factsAttachment?.content ?? "{}") as {
      quantities?: { anchorId?: string | null }[];
    };
    scriptedAskAnchors = (facts.quantities ?? [])
      .map((quantity) => quantity.anchorId)
      .filter((anchorId): anchorId is string => anchorId != null)
      .slice(0, 2);
  }
  return {
    output: {
      answer: "Thay đổi này tác động tới luồng hiện tại.",
      evidence: [
        {
          statement: "Giá trị hằng số thay đổi",
          anchors: firstPin === undefined ? scriptedAskAnchors : [firstPin],
        },
      ],
      speculation: [],
      unknowns: [],
    },
    rawResult: "{}",
    salvage: "clean",
    latencyMs: 5,
  };
};

const failingRunner: WorkflowRunner = async () => {
  throw new AiError("not-configured", "workflow URL or API key is missing");
};

let activeRunner: WorkflowRunner = scriptedRunner;

const appBundle = (() => {
  const db = openDatabase(":memory:");
  migrateDatabase(db);
  const app = createApp({
    db,
    log: pinoSilent,
    ai: {
      runner: (request) => activeRunner(request),
      config: { workflowUrl: "http://insea.test", apiKey: "test" },
    },
  });
  return { app, db };
})();

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), "cqa-whatif-"));
  mkdirSync(join(root, "Assets", "Scripts"), { recursive: true });
  mkdirSync(join(root, "Assets", "CSV"), { recursive: true });
  writeFileSync(join(root, "Assets", "Scripts", "Config.fcg"), FCG_BEFORE);
  writeFileSync(join(root, "Assets", "CSV", "UnitData.csv"), CSV_BEFORE);
  git(root, "init");
  git(root, "add", ".");
  git(root, "commit", "-m", "base");
  writeFileSync(join(root, "Assets", "Scripts", "Config.fcg"), FCG_AFTER);
  writeFileSync(join(root, "Assets", "CSV", "UnitData.csv"), CSV_AFTER);

  baseUrl = await new Promise<string>((resolve) => {
    server = serve({ fetch: appBundle.app.fetch, hostname: "127.0.0.1", port: 0 }, (info) =>
      resolve(`http://127.0.0.1:${info.port}`),
    );
  });

  const response = await fetch(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rootPath: root }),
  });
  expect(response.status).toBe(201);
  projectId = ProjectSummarySchema.parse(await response.json()).id;
});

afterAll(() => {
  server?.close();
});

function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function createSession(): Promise<string> {
  const response = await postJson(
    "/api/whatif/sessions",
    StartWhatIfSessionRequestSchema.parse({ projectId, baseRef: "HEAD", currentRef: "WORKTREE" }),
  );
  expect(response.status).toBe(201);
  const detail = WhatIfSessionDetailResponseSchema.parse(await response.json());
  return detail.session.id;
}

async function getSession(sessionId: string): Promise<WhatIfSessionDetailResponse> {
  const response = await fetch(`${baseUrl}/api/whatif/sessions/${sessionId}`);
  expect(response.status).toBe(200);
  return WhatIfSessionDetailResponseSchema.parse(await response.json());
}

function assistantTurns(turns: readonly WhatIfTurn[]): WhatIfTurn[] {
  return turns.filter((turn) => turn.role === "assistant");
}

async function waitForAnswer(sessionId: string, count: number): Promise<WhatIfTurn> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const detail = await getSession(sessionId);
    const answers = assistantTurns(detail.turns);
    const turn = answers[count - 1];
    if (turn !== undefined && (turn.answer !== null || turn.error !== null)) return turn;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`assistant turn ${count} never settled`);
}

async function ask(sessionId: string, question: string): Promise<string> {
  const response = await postJson(`/api/whatif/sessions/${sessionId}/ask`, { question });
  expect(response.status).toBe(202);
  const body = (await response.json()) as { turnId: string };
  return body.turnId;
}

async function readStream(turnId: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/whatif/turns/${turnId}/stream`);
  return response.text();
}

describe("what-if sessions", () => {
  it("creates a session for an A/B comparison and lists it", async () => {
    const sessionId = await createSession();
    const listResponse = await fetch(
      `${baseUrl}/api/whatif/sessions?projectId=${projectId}&base=HEAD&current=WORKTREE`,
    );
    expect(listResponse.status).toBe(200);
    const list = WhatIfSessionListResponseSchema.parse(await listResponse.json());
    const found = list.sessions.find((session) => session.id === sessionId);
    expect(found).toBeDefined();
    expect(found?.baseRef).toBe("HEAD");
    expect(found?.currentRef).toBe("WORKTREE");
  });

  it("answers with verified evidence and persists the ledger, manifest and stream", async () => {
    const sessionId = await createSession();
    const turnId = await ask(sessionId, "Vì sao chỉ số _MOD thay đổi?");
    const turn = await waitForAnswer(sessionId, 1);
    expect(turn.error).toBeNull();
    expect(turn.answer).not.toBeNull();
    expect(turn.answer?.answer).toContain("tác động");
    expect(turn.answer?.evidence.length ?? 0).toBeGreaterThan(0);
    expect(turn.answer?.evidence[0]?.anchors.length ?? 0).toBeGreaterThan(0);
    expect(turn.answer?.pinsUsed).toEqual([]);
    expect(turn.contextCounts?.pins).toBe(0);
    // First question: no completed turn yet to carry along.
    expect(turn.contextCounts?.turns).toBe(0);
    expect(turn.contextCounts?.evidence ?? 0).toBeGreaterThan(0);

    const stream = await readStream(turnId);
    expect(stream).toContain("event: answer");
    expect(stream).toContain("event: stage");

    const ledgers = appBundle.db
      .select()
      .from(sessionLedgers)
      .where(eq(sessionLedgers.sessionId, sessionId))
      .all();
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0]?.uptoTurn ?? 0).toBeGreaterThanOrEqual(1);

    const manifests = appBundle.db.select().from(contextManifests).all();
    const turnManifests = manifests.filter((row) => row.turnId === turnId);
    expect(turnManifests.length).toBe(1);
    expect(turnManifests[0]?.passId).toBe("whatif");
    expect(turnManifests[0]?.promptVersion).toBe("1.0.1");
  });

  it("carries recent turns into the next question", async () => {
    const sessionId = await createSession();
    await ask(sessionId, "Câu hỏi thứ nhất về thay đổi này?");
    await waitForAnswer(sessionId, 1);
    await ask(sessionId, "Câu hỏi tiếp theo dựa trên câu trả lời trước?");
    const second = await waitForAnswer(sessionId, 2);
    expect(second.error).toBeNull();
    expect(second.contextCounts?.turns).toBe(1);

    const historyAttachment = recordedCalls
      .map((call) => call.attachments.find((item) => item.uploadName === "history.json"))
      .filter((item) => item !== undefined)
      .at(-1);
    expect(historyAttachment?.content ?? "").toContain("Thay đổi này tác động");
  });

  it("pins ride across sessions of the same comparison", async () => {
    const sessionId = await createSession();
    await ask(sessionId, "Câu hỏi để lấy dẫn chứng hợp lệ?");
    const first = await waitForAnswer(sessionId, 1);
    const anchorId = first.answer?.evidence[0]?.anchors[0] ?? "";
    expect(anchorId.length).toBeGreaterThan(0);

    const pinResponse = await postJson("/api/whatif/pins", {
      projectId,
      baseRef: "HEAD",
      currentRef: "WORKTREE",
      anchorId,
      note: "theo dõi",
    });
    expect(pinResponse.status).toBe(201);
    const pin = PinSchema.parse(await pinResponse.json());

    const duplicate = await postJson("/api/whatif/pins", {
      projectId,
      baseRef: "HEAD",
      currentRef: "WORKTREE",
      anchorId,
    });
    expect(duplicate.status).toBe(201);
    expect(PinSchema.parse(await duplicate.json()).id).toBe(pin.id);

    const listResponse = await fetch(
      `${baseUrl}/api/whatif/pins?projectId=${projectId}&base=HEAD&current=WORKTREE`,
    );
    expect(PinListResponseSchema.parse(await listResponse.json()).pins).toHaveLength(1);

    // Second question of the same session: the pin already rides along.
    await ask(sessionId, "Dẫn chứng này nghĩa là gì?");
    const second = await waitForAnswer(sessionId, 2);
    expect(second.answer?.pinsUsed).toEqual([anchorId]);
    expect(second.contextCounts?.pins).toBe(1);

    // A brand-new session of the same comparison still gets the pin.
    const otherSession = await createSession();
    await ask(otherSession, "Phiên mới hỏi lại về dẫn chứng đã ghim?");
    const fresh = await waitForAnswer(otherSession, 1);
    expect(fresh.answer?.pinsUsed).toEqual([anchorId]);

    const removeResponse = await fetch(`${baseUrl}/api/whatif/pins/${pin.id}`, {
      method: "DELETE",
    });
    expect(removeResponse.status).toBe(204);
  });

  it("reports AI failure honestly on the assistant turn", async () => {
    activeRunner = failingRunner;
    try {
      const sessionId = await createSession();
      const turnId = await ask(sessionId, "Câu hỏi khi AI lỗi?");
      const turn = await waitForAnswer(sessionId, 1);
      expect(turn.answer).toBeNull();
      expect(turn.error).toContain("workflow URL");
      const stream = await readStream(turnId);
      expect(stream).toContain("event: failed");
    } finally {
      activeRunner = scriptedRunner;
    }
  });

  it("validates inputs and unknown ids", async () => {
    const badProject = await postJson("/api/whatif/sessions", {
      projectId: "missing-project",
      baseRef: "HEAD",
      currentRef: "WORKTREE",
    });
    expect(badProject.status).toBe(404);

    const worktreeBase = await postJson("/api/whatif/sessions", {
      projectId,
      baseRef: "WORKTREE",
      currentRef: "WORKTREE",
    });
    expect(worktreeBase.status).toBe(400);

    const sessionId = await createSession();
    const emptyQuestion = await postJson(`/api/whatif/sessions/${sessionId}/ask`, {
      question: "   ",
    });
    expect(emptyQuestion.status).toBe(400);

    const unknownSession = await fetch(`${baseUrl}/api/whatif/sessions/not-a-session`);
    expect(unknownSession.status).toBe(404);
    expect(ErrorEnvelopeSchema.parse(await unknownSession.json()).error.code).toBe("NOT_FOUND");

    const badPin = await postJson("/api/whatif/pins", {
      projectId,
      baseRef: "HEAD",
      currentRef: "WORKTREE",
      anchorId: "B:Assets/CSV/Ghost.csv:9:9:csv",
    });
    expect(badPin.status).toBe(400);

    const unknownPin = await fetch(`${baseUrl}/api/whatif/pins/not-a-pin`, {
      method: "DELETE",
    });
    expect(unknownPin.status).toBe(404);
  });
});

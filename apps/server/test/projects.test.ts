import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AppSettingsSchema,
  DetectProjectsResponseSchema,
  DiffSummarySchema,
  ErrorEnvelopeSchema,
  ProjectListResponseSchema,
  ProjectRefsResponseSchema,
} from "@craftland-qa/contracts";
import { migrateDatabase, openDatabase } from "@craftland-qa/db";
import type { Hono } from "hono";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

/** HTTP-level tests for E1 project registration + git preview, against real temp folders. */

let workspace: string;
let fakeGame: string;
let emptyDir: string;
let outside: string;
let app: Hono;

function git(cwd: string, args: readonly string[]): void {
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
    cwd,
    encoding: "utf8",
  });
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function putJson(path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "cqa-ws-"));
  outside = mkdtempSync(join(tmpdir(), "cqa-outside-"));

  // A fake project directly under the workspace (gproj + Assets/CSV + Assets/Script + git).
  fakeGame = join(workspace, "FakeGame");
  mkdirSync(join(fakeGame, "Assets", "CSV"), { recursive: true });
  mkdirSync(join(fakeGame, "Assets", "Script"), { recursive: true });
  writeFileSync(join(fakeGame, "Main.gproj"), "{}");
  writeFileSync(join(fakeGame, "Assets", "CSV", "Item.csv"), "id,name\n1,Sword\n");
  writeFileSync(join(fakeGame, "Assets", "Script", "Loader.fcg"), "static graph Loader\n");
  git(fakeGame, ["init"]);
  git(fakeGame, ["add", "-A"]);
  git(fakeGame, ["commit", "-m", "init"]);

  // A project nested two levels deep (wrapper folder), CSV-only marker.
  const deepGame = join(workspace, "Wrapper", "DeepGame");
  mkdirSync(join(deepGame, "Assets", "CSV"), { recursive: true });
  writeFileSync(join(deepGame, "Assets", "CSV", "Level.csv"), "id\n1\n");

  emptyDir = join(workspace, "NoMarkers");
  mkdirSync(emptyDir, { recursive: true });

  const db = openDatabase(":memory:");
  migrateDatabase(db);
  app = createApp({ db, log: pino({ level: "silent" }), defaultAllowedRoots: [workspace] });
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("E1 project + git routes", () => {
  it("detects candidates with marker evidence", async () => {
    const res = await postJson("/api/projects/detect", { rootPath: workspace });
    expect(res.status).toBe(200);
    const body = DetectProjectsResponseSchema.parse(await res.json());
    const names = body.candidates.map((candidate) => candidate.name);
    expect(names).toContain("FakeGame");
    expect(names).toContain("DeepGame");
    const fake = body.candidates.find((candidate) => candidate.name === "FakeGame");
    expect(fake?.markers.gprojFiles).toEqual(["Main.gproj"]);
    expect(fake?.markers.hasCsvDir).toBe(true);
    expect(fake?.markers.isGitRepo).toBe(true);
  });

  it("rejects detection outside allowed roots", async () => {
    const res = await postJson("/api/projects/detect", { rootPath: outside });
    expect(res.status).toBe(403);
    expect(ErrorEnvelopeSchema.parse(await res.json()).error.code).toBe("PATH_NOT_ALLOWED");
  });

  it("adds a project, lists it, rejects duplicates and non-projects", async () => {
    const res = await postJson("/api/projects", { rootPath: fakeGame });
    expect(res.status).toBe(201);

    const list = ProjectListResponseSchema.parse(await (await app.request("/api/projects")).json());
    expect(list.projects.map((project) => project.name)).toContain("FakeGame");

    const duplicate = await postJson("/api/projects", { rootPath: fakeGame });
    expect(duplicate.status).toBe(409);

    const notProject = await postJson("/api/projects", { rootPath: emptyDir });
    expect(notProject.status).toBe(422);
  });

  it("serves refs and a worktree diff summary", async () => {
    const list = ProjectListResponseSchema.parse(await (await app.request("/api/projects")).json());
    const project = list.projects.find((candidate) => candidate.name === "FakeGame");
    expect(project).toBeDefined();
    const id = project?.id ?? "";

    const refs = ProjectRefsResponseSchema.parse(
      await (await app.request(`/api/projects/${id}/refs`)).json(),
    );
    expect(refs.head).not.toBeNull();
    expect(refs.refs.length).toBeGreaterThan(0);

    writeFileSync(join(fakeGame, "Assets", "CSV", "Item.csv"), "id,name\n1,Shield\n2,Bow\n");
    const summary = DiffSummarySchema.parse(
      await (
        await app.request(`/api/projects/${id}/diff-summary?base=HEAD&current=WORKTREE`)
      ).json(),
    );
    expect(summary.filesChanged).toBe(1);
    expect(summary.files[0]?.path).toBe("Assets/CSV/Item.csv");
    expect(summary.files[0]?.kind).toBe("csv");
    expect(summary.csvFiles).toBe(1);
  });

  it("round-trips settings and validates roots", async () => {
    const initial = AppSettingsSchema.parse(await (await app.request("/api/settings")).json());
    expect(initial.allowedRoots).toEqual([workspace]);

    const invalid = await putJson("/api/settings", {
      allowedRoots: [join(workspace, "missing-dir")],
    });
    expect(invalid.status).toBe(400);

    const ok = await putJson("/api/settings", { allowedRoots: [workspace, outside] });
    expect(ok.status).toBe(200);
    expect(AppSettingsSchema.parse(await ok.json()).allowedRoots).toEqual([workspace, outside]);
  });

  it("removes a project", async () => {
    const list = ProjectListResponseSchema.parse(await (await app.request("/api/projects")).json());
    const id = list.projects.find((candidate) => candidate.name === "FakeGame")?.id ?? "";
    const res = await app.request(`/api/projects/${id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    const after = ProjectListResponseSchema.parse(
      await (await app.request("/api/projects")).json(),
    );
    expect(after.projects.some((project) => project.id === id)).toBe(false);
  });
});

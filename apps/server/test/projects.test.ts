import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  DiffSummarySchema,
  ErrorEnvelopeSchema,
  ProjectListResponseSchema,
  ProjectRefsResponseSchema,
  ProjectSummarySchema,
} from "@craftland-qa/contracts";
import { migrateDatabase, openDatabase } from "@craftland-qa/db";
import type { Hono } from "hono";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

/**
 * HTTP-level tests for E1 project registration + git preview.
 *
 * Registration is manual: any real folder can be added (no detection heuristics), and the
 * only rejections are protective facts — non-absolute paths, missing folders, files, drive
 * roots, the home directory and duplicates.
 */

let workspace: string;
let fakeGame: string;
let plainFolder: string;
let namedFolder: string;
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

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "cqa-ws-"));

  // A git-backed fake project with a CSV the diff preview can see.
  fakeGame = join(workspace, "FakeGame");
  mkdirSync(join(fakeGame, "Assets", "CSV"), { recursive: true });
  writeFileSync(join(fakeGame, "Assets", "CSV", "Item.csv"), "id,name\n1,Sword\n");
  git(fakeGame, ["init"]);
  git(fakeGame, ["add", "-A"]);
  git(fakeGame, ["commit", "-m", "init"]);

  // A folder with no Craftland markers at all — still registrable by design.
  plainFolder = join(workspace, "PlainFolder");
  mkdirSync(plainFolder, { recursive: true });

  // Folder used by the display-name normalization test.
  namedFolder = join(workspace, "NamedFolder");
  mkdirSync(namedFolder, { recursive: true });

  const db = openDatabase(":memory:");
  migrateDatabase(db);
  app = createApp({ db, log: pino({ level: "silent" }) });
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("E1 project + git routes", () => {
  it("adds a plain folder — registration is manual, no markers required", async () => {
    const res = await postJson("/api/projects", { rootPath: plainFolder });
    expect(res.status).toBe(201);
    const project = ProjectSummarySchema.parse(await res.json());
    expect(project.name).toBe("PlainFolder");

    const list = ProjectListResponseSchema.parse(await (await app.request("/api/projects")).json());
    expect(list.projects.map((candidate) => candidate.name)).toContain("PlainFolder");
  });

  it("normalizes the display name: trimmed input, folder name as default, length cap", async () => {
    const padded = await postJson("/api/projects", { rootPath: `  ${namedFolder}  ` });
    expect(padded.status).toBe(201);
    expect(ProjectSummarySchema.parse(await padded.json()).name).toBe("NamedFolder");

    const renamed = join(workspace, "RenamedFolder");
    mkdirSync(renamed, { recursive: true });
    const custom = await postJson("/api/projects", { rootPath: renamed, name: "  Game X  " });
    expect(custom.status).toBe(201);
    expect(ProjectSummarySchema.parse(await custom.json()).name).toBe("Game X");

    const blankName = await postJson("/api/projects", {
      rootPath: join(workspace, "Blank"),
      name: "   ",
    });
    expect(blankName.status).toBe(400);

    const tooLong = await postJson("/api/projects", {
      rootPath: join(workspace, "LongName"),
      name: "x".repeat(81),
    });
    expect(tooLong.status).toBe(400);
  });

  it("rejects non-absolute paths, drive roots and the home directory", async () => {
    const relative = await postJson("/api/projects", { rootPath: "relative/folder" });
    expect(relative.status).toBe(400);

    const driveRoot = await postJson("/api/projects", { rootPath: "C:\\" });
    expect(driveRoot.status).toBe(400);

    const home = await postJson("/api/projects", { rootPath: homedir() });
    expect(home.status).toBe(400);
  });

  it("rejects missing folders and files", async () => {
    const missing = await postJson("/api/projects", { rootPath: join(workspace, "missing-dir") });
    expect(missing.status).toBe(404);

    const filePath = join(workspace, "notes.txt");
    writeFileSync(filePath, "x");
    const asFile = await postJson("/api/projects", { rootPath: filePath });
    expect(asFile.status).toBe(400);
  });

  it("adds the game folder, serves refs and a worktree diff summary", async () => {
    const created = await postJson("/api/projects", { rootPath: fakeGame });
    expect(created.status).toBe(201);
    const id = ProjectSummarySchema.parse(await created.json()).id;

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
  });

  it("rejects duplicate registrations", async () => {
    const duplicate = await postJson("/api/projects", { rootPath: fakeGame });
    expect(duplicate.status).toBe(409);
    expect(ErrorEnvelopeSchema.parse(await duplicate.json()).error.code).toBe("CONFLICT");
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

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AttributionResponseSchema,
  BlameResponseSchema,
  WORKTREE_REF,
} from "@silentskip/contracts";
import { migrateDatabase, openDatabase, runs } from "@silentskip/db";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

function git(
  cwd: string,
  args: readonly string[],
  name = "Test",
  email = "test@example.com",
): string {
  return execFileSync(
    "git",
    ["-c", `user.name=${name}`, "-c", `user.email=${email}`, "-c", "core.quotepath=false", ...args],
    { cwd, encoding: "utf8" },
  );
}

describe("review attribution + blame", () => {
  let workspace = "";
  let app: ReturnType<typeof createApp>;
  let projectId = "";
  let runId = "";
  let baseSha = "";

  beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), "cqa-attribution-"));
    mkdirSync(join(workspace, "Assets", "CSV"), { recursive: true });
    const file = join(workspace, "Assets", "CSV", "Item.csv");
    writeFileSync(file, "id,title\n100,Sword\n", "utf8");
    git(workspace, ["init"]);
    git(workspace, ["add", "-A"]);
    git(workspace, ["commit", "-m", "localization table"], "Alice", "alice@example.com");
    baseSha = git(workspace, ["rev-parse", "HEAD"]).trim();

    writeFileSync(file, "id,title\n100,Sword\n200,Shield\n", "utf8");
    git(workspace, ["add", "-A"]);
    git(workspace, ["commit", "-m", "add shield row"], "Bob", "bob@example.com");

    writeFileSync(file, "id,title\n100,Broadsword\n200,Shield\n", "utf8");

    const db = openDatabase(":memory:");
    migrateDatabase(db);
    app = createApp({ db, log: pino({ level: "silent" }) });
    const response = await app.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rootPath: workspace, name: "Game" }),
    });
    const project = (await response.json()) as { id: string };
    projectId = project.id;

    runId = "run-attribution-1";
    db.insert(runs)
      .values({
        id: runId,
        projectId,
        baseRef: baseSha,
        currentRef: WORKTREE_REF,
        status: "completed",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        completedAt: new Date("2026-01-01T00:00:00.000Z"),
      })
      .run();
  });

  afterAll(() => {
    if (workspace !== "") rmSync(workspace, { recursive: true, force: true });
  });

  it("lists commits per changed file and flags worktree touches", async () => {
    const response = await app.request(`/api/reviews/${runId}/attribution`);
    expect(response.status).toBe(200);
    const body = AttributionResponseSchema.parse(await response.json());
    expect(body.base).toBe(baseSha);
    const file = body.files.find((entry) => entry.path === "Assets/CSV/Item.csv");
    expect(file).toBeDefined();
    expect(file?.commitCount).toBe(1);
    expect(file?.commits[0]?.author).toBe("Bob");
    expect(file?.commits[0]?.subject).toBe("add shield row");
    expect(file?.changedInWorktree).toBe(true);
  });

  it("blames lines and labels uncommitted lines", async () => {
    const response = await app.request(
      `/api/reviews/${runId}/blame?file=${encodeURIComponent("Assets/CSV/Item.csv")}&lineStart=1&lineEnd=2`,
    );
    expect(response.status).toBe(200);
    const body = BlameResponseSchema.parse(await response.json());
    expect(body.lines).toHaveLength(2);
    expect(body.lines[0]?.author).toBe("Alice");
    expect(body.lines[0]?.uncommitted).toBe(false);
    expect(body.lines[1]?.uncommitted).toBe(true);
    expect(body.lines[1]?.author).toBe("chưa commit");
  });

  it("rejects traversal and missing parameters", async () => {
    const traversal = await app.request(
      `/api/reviews/${runId}/blame?file=${encodeURIComponent("../secret")}&lineStart=1&lineEnd=1`,
    );
    expect(traversal.status).toBe(400);
    const missing = await app.request(`/api/reviews/${runId}/blame?file=Assets/CSV/Item.csv`);
    expect(missing.status).toBe(400);
  });
});

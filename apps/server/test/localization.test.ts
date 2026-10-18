import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalizationReportSchema } from "@silentskip/contracts";
import { migrateDatabase, openDatabase } from "@silentskip/db";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../src/app";

const KEY_PATH = "Assets/Localization/key.csv";
const BEFORE = "Key,English,Vietnamese\nHELLO,Hello,Xin chào\n";
const AFTER = `${BEFORE}BYE,Bye {0} {1},Tạm biệt {0}\n`;

let workspace: string;
let app: ReturnType<typeof createApp>;
let projectId: string;

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: workspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function write(path: string, content: string): void {
  const absolute = join(workspace, path);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), "craftland-localization-"));
  mkdirSync(join(workspace, "Assets", "Localization"), { recursive: true });
  write(KEY_PATH, BEFORE);
  git(["init"]);
  git(["config", "user.name", "Test"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "core.autocrlf", "false"]);
  git(["add", "."]);
  git(["commit", "-m", "initial"]);
  write(KEY_PATH, AFTER);

  const db = openDatabase(":memory:");
  migrateDatabase(db);
  app = createApp({ db, log: pino({ level: "silent" }) });
  const response = await app.request("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rootPath: workspace, name: "Localization" }),
  });
  expect(response.status).toBe(201);
  const project = (await response.json()) as { id: string };
  projectId = project.id;
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("GET /api/projects/:id/localization", () => {
  it("detects a localization table and reports placeholder and key changes", async () => {
    const response = await app.request(
      `/api/projects/${projectId}/localization?base=HEAD&current=WORKTREE`,
    );
    expect(response.status).toBe(200);
    const report = LocalizationReportSchema.parse(await response.json());
    expect(report.refs).toEqual({ base: "HEAD", current: "WORKTREE" });
    const table = report.tables.find((entry) => entry.path === KEY_PATH);
    expect(table).toBeDefined();
    expect(table?.status).toBe("changed");
    expect(table?.keyCount).toBe(2);
    expect(table?.placeholderMismatchCount).toBe(1);
    expect(table?.addedKeyCount).toBe(1);
    const placeholder = table?.issues.find((issue) => issue.kind === "placeholder-mismatch");
    expect(placeholder?.samples).toEqual(["BYE"]);
    expect(placeholder?.anchors[0]?.id).toBe(`B:${KEY_PATH}:1:1:csv`);
    expect(report.totals.placeholderMismatches).toBe(1);
  });

  it("rejects missing parameters with the shared error envelope", async () => {
    const response = await app.request(`/api/projects/${projectId}/localization`);
    expect(response.status).toBe(400);
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsListResponseSchema } from "@silentskip/contracts";
import { migrateDatabase, openDatabase } from "@silentskip/db";
import type { Hono } from "hono";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

/**
 * Folder-picker tests (`GET /api/fs/list`): explicit one-level browsing, directories only,
 * with a parent pointer for going up — no scanning, no classification.
 */

let root: string;
let app: Hono;

async function list(path?: string): Promise<Response> {
  const query = path === undefined ? "" : `?path=${encodeURIComponent(path)}`;
  return app.request(`/api/fs/list${query}`);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cqa-fs-"));
  mkdirSync(join(root, "Alpha"), { recursive: true });
  mkdirSync(join(root, "beta"), { recursive: true });
  mkdirSync(join(root, "zeta"), { recursive: true });
  mkdirSync(join(root, ".cache"), { recursive: true });
  mkdirSync(join(root, "$sys"), { recursive: true });
  writeFileSync(join(root, "notes.txt"), "x");

  const db = openDatabase(":memory:");
  migrateDatabase(db);
  app = createApp({ db, log: pino({ level: "silent" }) });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("GET /api/fs/list", () => {
  it("lists directories only: visible before hidden, each sorted case-insensitively", async () => {
    const res = await list(root);
    expect(res.status).toBe(200);
    const body = FsListResponseSchema.parse(await res.json());
    expect(body.path?.toLowerCase()).toBe(root.toLowerCase());

    const names = body.directories.map((entry) => entry.name);
    expect(names.slice(0, 3)).toEqual(["Alpha", "beta", "zeta"]);
    expect(names.slice(3).sort()).toEqual(["$sys", ".cache"]);
    expect(body.directories[0]?.hidden).toBe(false);
    expect(body.directories[3]?.hidden).toBe(true);
  });

  it("navigates up via the parent pointer", async () => {
    const body = FsListResponseSchema.parse(await (await list(join(root, "Alpha"))).json());
    expect(body.parent?.toLowerCase()).toBe(root.toLowerCase());
    expect(body.directories).toEqual([]);
  });

  it("lists drive roots when no path is given", async () => {
    const body = FsListResponseSchema.parse(await (await list()).json());
    expect(body.path).toBeNull();
    expect(body.parent).toBeNull();
    expect(body.directories.length).toBeGreaterThan(0);
  });

  it("rejects missing folders and files", async () => {
    const missing = await list(join(root, "missing-dir"));
    expect(missing.status).toBe(404);

    const asFile = await list(join(root, "notes.txt"));
    expect(asFile.status).toBe(400);
  });
});

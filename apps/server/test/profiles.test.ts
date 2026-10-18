import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ErrorEnvelopeSchema,
  ProjectProfileSchema,
  ProjectSummarySchema,
} from "@craftland-qa/contracts";
import { migrateDatabase, openDatabase } from "@craftland-qa/db";
import type { Hono } from "hono";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

/**
 * E8.2 profile API — the profile is plain data owned by the server.
 *
 * A project with no row returns the honest empty profile; a PUT round-trips every writable
 * field and the server keeps `projectId`/`updatedAt` authoritative.
 */

let workspace: string;
let projectId: string;
let app: Hono;

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), "cqa-profile-"));
  const root = join(workspace, "ProfileGame");
  mkdirSync(root, { recursive: true });
  const db = openDatabase(":memory:");
  migrateDatabase(db);
  app = createApp({ db, log: pino({ level: "silent" }) });
  const response = await app.request("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rootPath: root }),
  });
  projectId = ProjectSummarySchema.parse(await response.json()).id;
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("E8.2 project profile routes", () => {
  it("returns the empty profile before any save", async () => {
    const response = await app.request(`/api/projects/${projectId}/profile`);
    expect(response.status).toBe(200);
    const profile = ProjectProfileSchema.parse(await response.json());
    expect(profile.projectId).toBe(projectId);
    expect(profile.conventions).toEqual([]);
    expect(profile.readApiFamily).toEqual([]);
    expect(profile.overrides).toEqual([]);
    expect(profile.coverage).toBeNull();
    expect(profile.editorGenIndex).toBe(false);
  });

  it("round-trips conventions, read API family and overrides", async () => {
    const body = {
      conventions: [
        {
          id: "conv-1",
          kind: "binding",
          statement: "CSV tables are read through an index enum",
          evidence: [{ file: "Assets/Scripts/Data/ItemData.fcg" }],
          source: "user",
          createdAt: "2026-10-18T00:00:00.000Z",
        },
      ],
      readApiFamily: ["ConfigManager"],
      overrides: [
        {
          id: "pin-1",
          kind: "pin-binding",
          target: { csvPath: "Assets/CSV/Item.csv" },
          value: "EItemColumn",
          note: "header enum",
          createdAt: "2026-10-18T00:00:00.000Z",
        },
        {
          id: "note-1",
          kind: "entity-note",
          target: { file: "Assets/Scripts/Data/ItemData.fcg" },
          note: "Loaded during prewarm",
          createdAt: "2026-10-18T00:00:00.000Z",
        },
      ],
      coverage: null,
      editorGenIndex: true,
      readerProfile: {
        bindings: [{ csvPath: "Assets/CSV/Item.csv", columns: ["id", "title"] }],
        guards: [{ csvPath: "Assets/CSV/Item.csv", constant: 5 }],
        structuredCells: [
          {
            csvPath: "Assets/CSV/Loot.csv",
            column: "rewards",
            targetPath: "Assets/CSV/Item.csv",
            split: "colon",
            cast: "int",
            part: 0,
          },
        ],
      },
    };
    const saved = await app.request(`/api/projects/${projectId}/profile`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(saved.status).toBe(200);
    const profile = ProjectProfileSchema.parse(await saved.json());
    expect(profile.conventions).toHaveLength(1);
    expect(profile.readApiFamily).toEqual(["ConfigManager"]);
    expect(profile.overrides.map((entry) => entry.kind)).toEqual(["pin-binding", "entity-note"]);
    expect(profile.editorGenIndex).toBe(true);
    expect(profile.readerProfile.bindings).toEqual([
      { csvPath: "Assets/CSV/Item.csv", columns: ["id", "title"] },
    ]);
    expect(profile.readerProfile.structuredCells[0]?.part).toBe(0);

    const reloaded = await app.request(`/api/projects/${projectId}/profile`);
    const again = ProjectProfileSchema.parse(await reloaded.json());
    expect(again.overrides).toHaveLength(2);
    expect(again.updatedAt).toBe(profile.updatedAt);
  });

  it("rejects an invalid profile body", async () => {
    const response = await app.request(`/api/projects/${projectId}/profile`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conventions: [], readApiFamily: [], overrides: [] }),
    });
    expect(response.status).toBe(400);
  });

  it("returns 404 for an unknown project", async () => {
    const response = await app.request("/api/projects/does-not-exist/profile");
    expect(response.status).toBe(404);
    expect(ErrorEnvelopeSchema.parse(await response.json()).error.code).toBe("NOT_FOUND");
  });
});

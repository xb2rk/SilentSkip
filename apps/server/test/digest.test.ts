import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DigestBundleSchema, ErrorEnvelopeSchema, WORKTREE_REF } from "@silentskip/contracts";
import { migrateDatabase, openDatabase } from "@silentskip/db";
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
const CSV_AFTER = "id,atk\nscout,100\nscout,120,999\n";

let workspace: string;
let gameDir: string;
let gameId: string;
let app: ReturnType<typeof createApp>;

function git(args: readonly string[]): void {
  execFileSync(
    "git",
    ["-C", gameDir, "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args],
    { encoding: "utf8" },
  );
}

async function addProject(rootPath: string): Promise<string> {
  const response = await app.request("/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rootPath }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { id: string };
  return body.id;
}

beforeAll(async () => {
  workspace = mkdtempSync(join(tmpdir(), "cqa-digest-"));
  gameDir = join(workspace, "Game");
  mkdirSync(join(gameDir, "Assets", "Scripts"), { recursive: true });
  mkdirSync(join(gameDir, "Assets", "CSV"), { recursive: true });
  writeFileSync(join(gameDir, "Assets", "Scripts", "Config.fcg"), FCG_BEFORE);
  writeFileSync(join(gameDir, "Assets", "CSV", "UnitData.csv"), CSV_BEFORE);
  git(["init"]);
  git(["add", "-A"]);
  git(["commit", "-m", "initial"]);
  writeFileSync(join(gameDir, "Assets", "Scripts", "Config.fcg"), FCG_AFTER);
  writeFileSync(join(gameDir, "Assets", "CSV", "UnitData.csv"), CSV_AFTER);
  const db = openDatabase(":memory:");
  migrateDatabase(db);
  app = createApp({ db, log: pino({ level: "silent" }) });
  gameId = await addProject(gameDir);
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("GET /api/projects/:id/digest", () => {
  it("builds a schema-valid deterministic digest for a real commit range", async () => {
    const response = await app.request(
      `/api/projects/${gameId}/digest?base=HEAD&current=${WORKTREE_REF}`,
    );
    expect(response.status).toBe(200);
    const digest = DigestBundleSchema.parse(await response.json());
    expect(digest.refs.base.ref).toBe("HEAD");
    expect(digest.refs.current.ref).toBe(WORKTREE_REF);
    expect(digest.refs.current.commitHash).toBeNull();
    expect(digest.stats.filesChanged).toBe(2);
    expect(digest.stats.symbolsChanged).toBe(1);
    expect(digest.anchors.length).toBeGreaterThan(0);
    expect(digest.linked.length).toBeGreaterThan(0);

    const again = await app.request(
      `/api/projects/${gameId}/digest?base=HEAD&current=${WORKTREE_REF}`,
    );
    expect(await again.json()).toEqual(digest);
  });

  it("rejects a missing or worktree base and unknown refs", async () => {
    const missing = await app.request(`/api/projects/${gameId}/digest`);
    expect(missing.status).toBe(400);

    const worktreeBase = await app.request(
      `/api/projects/${gameId}/digest?base=${WORKTREE_REF}&current=${WORKTREE_REF}`,
    );
    expect(worktreeBase.status).toBe(400);
    expect(ErrorEnvelopeSchema.parse(await worktreeBase.json()).error.code).toBe("BAD_REQUEST");

    const unknown = await app.request(
      `/api/projects/${gameId}/digest?base=no-such-ref&current=${WORKTREE_REF}`,
    );
    expect(unknown.status).toBe(400);
    expect(ErrorEnvelopeSchema.parse(await unknown.json()).error.code).toBe("UNKNOWN_REF");
  });

  it("rejects a folder that is not a git repository", async () => {
    const plain = join(workspace, "Plain");
    mkdirSync(plain, { recursive: true });
    const id = await addProject(plain);
    const response = await app.request(
      `/api/projects/${id}/digest?base=HEAD&current=${WORKTREE_REF}`,
    );
    expect(response.status).toBe(422);
    expect(ErrorEnvelopeSchema.parse(await response.json()).error.code).toBe("NOT_A_GIT_REPO");
  });

  it("applies a saved row-key pin to the digest surface", async () => {
    const save = await app.request(`/api/projects/${gameId}/profile`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conventions: [],
        readApiFamily: [],
        overrides: [
          {
            id: "pin-unit-key",
            kind: "pin-row-key",
            target: { csvPath: "Assets/CSV/UnitData.csv" },
            value: "id",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        coverage: null,
        editorGenIndex: false,
      }),
    });
    expect(save.status).toBe(200);

    const response = await app.request(
      `/api/projects/${gameId}/digest?base=HEAD&current=${WORKTREE_REF}`,
    );
    expect(response.status).toBe(200);
    const digest = DigestBundleSchema.parse(await response.json());
    const duplicate = digest.surfaces.current.entries.find(
      (entry) => entry.table === "Assets/CSV/UnitData.csv" && entry.mechanism === "duplicate_key",
    );
    expect(duplicate?.confidence).toBe("exact");
    expect(duplicate?.rowKey).toBe("scout");
  });

  it("applies a composite row-key pin end to end", async () => {
    const save = await app.request(`/api/projects/${gameId}/profile`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conventions: [],
        readApiFamily: [],
        overrides: [
          {
            id: "pin-unit-key",
            kind: "pin-row-key",
            target: { csvPath: "Assets/CSV/UnitData.csv" },
            value: "id,atk",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        coverage: null,
        editorGenIndex: false,
      }),
    });
    expect(save.status).toBe(200);

    const response = await app.request(
      `/api/projects/${gameId}/digest?base=HEAD&current=${WORKTREE_REF}`,
    );
    expect(response.status).toBe(200);
    const digest = DigestBundleSchema.parse(await response.json());
    const entries = digest.surfaces.current.entries.filter(
      (entry) => entry.table === "Assets/CSV/UnitData.csv",
    );
    expect(entries.some((entry) => entry.mechanism === "duplicate_key")).toBe(false);
    const ragged = entries.find((entry) => entry.mechanism === "length_guard");
    expect(ragged?.rowKey).toBe("scout\u001f120");
  });
});

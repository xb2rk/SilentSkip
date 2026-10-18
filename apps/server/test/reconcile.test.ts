import { migrateDatabase, openDatabase, projects, runs } from "@silentskip/db";
import { describe, expect, it } from "vitest";
import { reconcileInterruptedRuns } from "../src/reviews";

describe("reconcileInterruptedRuns", () => {
  it("marks orphaned queued/running runs as failed and leaves finished runs alone", () => {
    const db = openDatabase(":memory:");
    migrateDatabase(db);
    const now = new Date("2026-01-01T00:00:00.000Z");
    db.insert(projects)
      .values({ id: "p1", name: "Game", rootPath: "/tmp/game", createdAt: now })
      .run();
    for (const [id, status] of [
      ["r-running", "running"],
      ["r-queued", "queued"],
      ["r-done", "completed"],
    ] as const) {
      db.insert(runs)
        .values({
          id,
          projectId: "p1",
          baseRef: "main",
          currentRef: "main",
          status,
          createdAt: now,
          ...(status === "completed" ? { completedAt: now } : {}),
        })
        .run();
    }

    expect(reconcileInterruptedRuns(db)).toBe(2);
    const byId = new Map(
      db
        .select()
        .from(runs)
        .all()
        .map((row) => [row.id, row]),
    );
    for (const id of ["r-running", "r-queued"]) {
      expect(byId.get(id)?.status).toBe("failed");
      expect(byId.get(id)?.error).toContain("khởi động lại");
      expect(byId.get(id)?.completedAt).not.toBeNull();
    }
    expect(byId.get("r-done")?.status).toBe("completed");
    expect(byId.get("r-done")?.error).toBeNull();
    expect(reconcileInterruptedRuns(db)).toBe(0);
  });
});

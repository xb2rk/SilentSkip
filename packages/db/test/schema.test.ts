import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { migrateDatabase, openDatabase } from "../src/client";
import { projects } from "../src/schema";

describe("database schema + migrations", () => {
  it("applies migrations and round-trips a project row", () => {
    const db = openDatabase(":memory:");
    migrateDatabase(db);

    const id = randomUUID();
    db.insert(projects)
      .values({ id, name: "SampleProject", rootPath: "C:/games/pvz", createdAt: new Date() })
      .run();

    const row = db.select().from(projects).where(eq(projects.id, id)).get();
    expect(row?.name).toBe("SampleProject");
  });
});

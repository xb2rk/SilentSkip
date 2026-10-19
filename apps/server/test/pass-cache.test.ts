import { migrateDatabase, openDatabase } from "@silentskip/db";
import { describe, expect, it } from "vitest";
import { createSqlitePassCache } from "../src/pass-cache";

const CALL = {
  pass: "read",
  output: { findings: [], unknowns: [], negativeResults: [], needMore: [] },
  rawResult: '{"findings":[]}',
  salvage: "clean",
  latencyMs: 4321,
} as const;

describe("sqlite pass cache", () => {
  it("stores a call by key and returns it unchanged", async () => {
    const db = openDatabase(":memory:");
    migrateDatabase(db);
    const cache = createSqlitePassCache(db);

    expect(await cache.get("never-stored")).toBeUndefined();
    await cache.set("key-1", CALL);
    expect(await cache.get("key-1")).toEqual(CALL);
  });

  it("keeps the first answer for identical inputs", async () => {
    const db = openDatabase(":memory:");
    migrateDatabase(db);
    const cache = createSqlitePassCache(db);

    await cache.set("key-1", CALL);
    await cache.set("key-1", { ...CALL, output: { findings: [{ title: "a different answer" }] } });
    expect(await cache.get("key-1")).toEqual(CALL);
  });
});

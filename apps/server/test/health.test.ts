import { ErrorEnvelopeSchema, HealthResponseSchema } from "@craftland-qa/contracts";
import { migrateDatabase, openDatabase } from "@craftland-qa/db";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const log = pino({ level: "silent" });

function appForTest() {
  const db = openDatabase(":memory:");
  migrateDatabase(db);
  return createApp({ db, log });
}

describe("GET /api/health (in-process)", () => {
  it("returns a schema-valid payload backed by a migrated database", async () => {
    const res = await appForTest().request("/api/health");
    expect(res.status).toBe(200);
    const body = HealthResponseSchema.parse(await res.json());
    expect(body.database).toBe("ok");
  });

  it("returns a 404 error envelope for unknown routes", async () => {
    const res = await appForTest().request("/api/does-not-exist");
    expect(res.status).toBe(404);
    const body = ErrorEnvelopeSchema.parse(await res.json());
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

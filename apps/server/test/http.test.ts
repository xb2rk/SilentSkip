import { ErrorEnvelopeSchema, HealthResponseSchema } from "@craftland-qa/contracts";
import { migrateDatabase, openDatabase } from "@craftland-qa/db";
import { type ServerType, serve } from "@hono/node-server";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

describe("@hono/node-server integration", () => {
  let server: ServerType | undefined;
  let baseUrl = "";

  beforeAll(async () => {
    const db = openDatabase(":memory:");
    migrateDatabase(db);
    const app = createApp({ db, log: pino({ level: "silent" }) });
    baseUrl = await new Promise<string>((resolveUrl) => {
      server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) => {
        resolveUrl(`http://127.0.0.1:${info.port}`);
      });
    });
  });

  afterAll(async () => {
    if (server !== undefined) {
      await new Promise<void>((done) => server?.close(() => done()));
    }
  });

  it("serves real HTTP on an ephemeral port", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = HealthResponseSchema.parse(await res.json());
    expect(body.ok).toBe(true);
  });

  it("returns the shared error envelope for malformed bodies and unknown routes", async () => {
    const malformed = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(malformed.status).toBe(400);
    expect(ErrorEnvelopeSchema.parse(await malformed.json()).error.code).toBe("BAD_REQUEST");

    const unknown = await fetch(`${baseUrl}/api/definitely-not-a-route`);
    expect(unknown.status).toBe(404);
    expect(ErrorEnvelopeSchema.parse(await unknown.json()).error.code).toBe("NOT_FOUND");
  });
});

import { describe, expect, it } from "vitest";
import { API_VERSION, HealthResponseSchema, PRODUCT_VERSION } from "../src/index";

describe("HealthResponseSchema", () => {
  const valid = {
    ok: true as const,
    product: "craftland-qa" as const,
    version: PRODUCT_VERSION,
    apiVersion: API_VERSION,
    uptimeSeconds: 42,
    database: "ok" as const,
    timestamp: "2026-10-16T09:00:00.000Z",
  };

  it("accepts a well-formed health payload", () => {
    expect(HealthResponseSchema.parse(valid)).toEqual(valid);
  });

  it("rejects an unknown database status", () => {
    expect(() => HealthResponseSchema.parse({ ...valid, database: "maybe" })).toThrow();
  });

  it("rejects a mismatched product name", () => {
    expect(() => HealthResponseSchema.parse({ ...valid, product: "other-tool" })).toThrow();
  });
});

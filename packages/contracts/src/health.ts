import { z } from "zod";
import { API_VERSION, PRODUCT_VERSION } from "./version";

/**
 * Health payload used by the web shell to prove end-to-end wiring (web → API → database).
 * Values are literals so a version bump fails the contract loudly instead of drifting.
 */
export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  product: z.literal("silentskip"),
  version: z.literal(PRODUCT_VERSION),
  apiVersion: z.literal(API_VERSION),
  uptimeSeconds: z.number(),
  database: z.enum(["ok", "error"]),
  timestamp: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

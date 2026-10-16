import { AppSettingsSchema, UpdateSettingsRequestSchema } from "@craftland-qa/contracts";
import type { AppDatabase } from "@craftland-qa/db";
import { Hono } from "hono";
import { getSettings, updateSettings } from "../settings";
import { readJsonBody } from "./utils";

/** Dependencies of the settings routes. */
export interface SettingsRoutesDeps {
  readonly db: AppDatabase;
  readonly defaultAllowedRoots: readonly string[];
}

/** Application settings routes (E1: allowed roots; later phases reuse the same endpoints). */
export function createSettingsRoutes(deps: SettingsRoutesDeps): Hono {
  const app = new Hono();

  const current = () => getSettings(deps.db, { allowedRoots: [...deps.defaultAllowedRoots] });

  app.get("/", (c) => c.json(AppSettingsSchema.parse(current())));

  app.put("/", async (c) => {
    const input = await readJsonBody(c.req.raw, UpdateSettingsRequestSchema);
    const next = updateSettings(deps.db, input);
    return c.json(AppSettingsSchema.parse(next));
  });

  return app;
}

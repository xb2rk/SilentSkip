import { type PassConfig, runInseaWorkflow, type WorkflowRunner } from "@craftland-qa/ai";
import {
  API_VERSION,
  AppError,
  ErrorCodes,
  HealthResponseSchema,
  PRODUCT_VERSION,
} from "@craftland-qa/contracts";
import type { AppDatabase } from "@craftland-qa/db";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Logger } from "pino";
import { ReviewManager } from "./reviews";
import { createFsRoutes } from "./routes/fs.routes";
import { createProjectsRoutes } from "./routes/projects.routes";
import { createReviewsRoutes } from "./routes/reviews.routes";

/** Dependencies injected into the HTTP app so handlers stay testable without real I/O. */
export interface AppDependencies {
  readonly db: AppDatabase;
  readonly log: Logger;
  /**
   * AI wiring for review runs. Optional so non-review tests stay one-liners; production passes
   * the loaded workflow config. Without a config the client reports `not-configured` and runs
   * complete through the deterministic fallback.
   */
  readonly ai?: {
    readonly runner?: WorkflowRunner;
    readonly config?: PassConfig;
  };
}

/**
 * Build the Hono application.
 *
 * Wiring rules that later endpoints must keep:
 * - Success responses are parsed through their contract schema before leaving (fail fast in
 *   dev when server and contracts disagree instead of shipping a lying payload).
 * - All errors leave as the shared error envelope; unexpected errors are logged with the
 *   original error attached and never leak internals to the client.
 */
export function createApp(deps: AppDependencies): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    const startedAt = performance.now();
    await next();
    deps.log.debug(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - startedAt),
      },
      "request",
    );
  });

  app.get("/api/health", async (c) => {
    const database = checkDatabase(deps.db);
    const body = HealthResponseSchema.parse({
      ok: true,
      product: "craftland-qa",
      version: PRODUCT_VERSION,
      apiVersion: API_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      database,
      timestamp: new Date().toISOString(),
    });
    return c.json(body);
  });

  app.route("/api/projects", createProjectsRoutes({ db: deps.db }));
  app.route("/api/fs", createFsRoutes());

  const reviewManager = new ReviewManager({
    db: deps.db,
    log: deps.log,
    runner: deps.ai?.runner ?? runInseaWorkflow,
    config: deps.ai?.config ?? { workflowUrl: null, apiKey: null },
  });
  app.route("/api/reviews", createReviewsRoutes({ manager: reviewManager }));

  app.notFound((c) => {
    const envelope = new AppError(
      ErrorCodes.notFound,
      `Route not found: ${c.req.path}`,
    ).toEnvelope();
    return c.json(envelope, 404);
  });

  app.onError((error, c) => {
    if (error instanceof AppError) {
      deps.log.warn({ err: error, code: error.code }, "request failed");
      return c.json(error.toEnvelope(), error.status as ContentfulStatusCode);
    }
    deps.log.error({ err: error }, "unhandled server error");
    const envelope = new AppError(ErrorCodes.internal, "Internal server error").toEnvelope();
    return c.json(envelope, 500);
  });

  return app;
}

/**
 * Health probe: one trivial query through the real database handle.
 * Sync by design (node:sqlite), wrapped to keep the endpoint async-uniform.
 */
function checkDatabase(db: AppDatabase): "ok" | "error" {
  try {
    db.run(sql`select 1`);
    return "ok";
  } catch {
    return "error";
  }
}

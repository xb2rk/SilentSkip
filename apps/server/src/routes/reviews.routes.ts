import {
  RunDetailResponseSchema,
  RunListResponseSchema,
  StartReviewRequestSchema,
  StartReviewResponseSchema,
} from "@craftland-qa/contracts";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ReviewManager } from "../reviews";
import { readJsonBody } from "./utils";

/** Dependencies of the review routes. */
export interface ReviewsRoutesDeps {
  readonly manager: ReviewManager;
}

/**
 * Review-run routes (E4.4): start (202 + runId), poll, cancel, and the SSE stream.
 * The stream replays buffered events, so connecting after completion still yields the full
 * history plus the terminal event — and then closes.
 */
export function createReviewsRoutes(deps: ReviewsRoutesDeps): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const input = await readJsonBody(c.req.raw, StartReviewRequestSchema);
    const runId = deps.manager.startReview(input);
    return c.json(StartReviewResponseSchema.parse({ runId }), 202);
  });

  app.get("/", (c) => {
    const projectId = c.req.query("projectId");
    const runs = deps.manager.listRuns(
      projectId === undefined || projectId === "" ? undefined : projectId,
    );
    return c.json(RunListResponseSchema.parse({ runs }));
  });

  app.get("/:runId", (c) => {
    return c.json(RunDetailResponseSchema.parse(deps.manager.getRun(c.req.param("runId"))));
  });

  app.get("/:runId/stream", (c) => {
    const channel = deps.manager.channel(c.req.param("runId"));
    return streamSSE(c, async (stream) => {
      await channel.attach(async (event) => {
        await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      });
    });
  });

  app.post("/:runId/cancel", (c) => {
    return c.json(RunDetailResponseSchema.parse(deps.manager.cancel(c.req.param("runId"))));
  });

  return app;
}

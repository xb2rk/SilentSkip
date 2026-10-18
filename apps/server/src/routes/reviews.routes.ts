import {
  AppError,
  AttributionResponseSchema,
  BlameResponseSchema,
  ErrorCodes,
  ReviewCompareResponseSchema,
  RunDetailResponseSchema,
  RunListResponseSchema,
  StartReviewRequestSchema,
  StartReviewResponseSchema,
} from "@silentskip/contracts";
import type { AppDatabase } from "@silentskip/db";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { blameLines, fileAttribution } from "../attribution";
import { compareRuns } from "../compare";
import { getProject } from "../projects";
import type { ReviewManager } from "../reviews";
import { readJsonBody } from "./utils";

/** Dependencies of the review routes. */
export interface ReviewsRoutesDeps {
  readonly manager: ReviewManager;
  readonly db: AppDatabase;
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

  /** Deterministic diff between two stored runs (E9.4) - registered before `/:runId`. */
  app.get("/compare", (c) => {
    const leftId = c.req.query("left");
    const rightId = c.req.query("right");
    if (leftId === undefined || leftId === "" || rightId === undefined || rightId === "") {
      throw new AppError(ErrorCodes.badRequest, "Thiếu tham số `left` hoặc `right`");
    }
    return c.json(
      ReviewCompareResponseSchema.parse(
        compareRuns(deps.manager.getRun(leftId), deps.manager.getRun(rightId)),
      ),
    );
  });

  app.get("/:runId", (c) => {
    return c.json(RunDetailResponseSchema.parse(deps.manager.getRun(c.req.param("runId"))));
  });

  /** File-level attribution for one run's A/B range (E9.3). */
  app.get("/:runId/attribution", async (c) => {
    const run = deps.manager.getRun(c.req.param("runId"));
    const project = getProject(deps.db, run.projectId);
    return c.json(
      AttributionResponseSchema.parse(
        await fileAttribution(project.rootPath, run.baseRef, run.currentRef),
      ),
    );
  });

  /** Line-level blame for a file span inside one run's current side (E9.3). */
  app.get("/:runId/blame", async (c) => {
    const run = deps.manager.getRun(c.req.param("runId"));
    const project = getProject(deps.db, run.projectId);
    const file = c.req.query("file");
    const startRaw = c.req.query("lineStart");
    const endRaw = c.req.query("lineEnd");
    const startLine = Number.parseInt(startRaw ?? "", 10);
    const endLine = Number.parseInt(endRaw ?? "", 10);
    if (file === undefined || file === "" || Number.isNaN(startLine) || Number.isNaN(endLine)) {
      throw new AppError(ErrorCodes.badRequest, "Thiếu tham số `file`, `lineStart` hoặc `lineEnd`");
    }
    return c.json(
      BlameResponseSchema.parse(
        await blameLines(project.rootPath, run.currentRef, file, startLine, endLine),
      ),
    );
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

  /** Who changed the files of this run (E9.3) - commits per file plus worktree flags. */
  app.get("/:runId/attribution", async (c) => {
    const run = deps.manager.getRun(c.req.param("runId"));
    const project = getProject(deps.db, run.projectId);
    const attribution = await fileAttribution(project.rootPath, run.baseRef, run.currentRef);
    return c.json(AttributionResponseSchema.parse(attribution));
  });

  /** Line-level blame inside one file of this run (E9.3). */
  app.get("/:runId/blame", async (c) => {
    const run = deps.manager.getRun(c.req.param("runId"));
    const project = getProject(deps.db, run.projectId);
    const file = c.req.query("file");
    const lineStart = Number.parseInt(c.req.query("lineStart") ?? "", 10);
    const lineEnd = Number.parseInt(c.req.query("lineEnd") ?? "", 10);
    if (file === undefined || file === "" || Number.isNaN(lineStart) || Number.isNaN(lineEnd)) {
      throw new AppError(ErrorCodes.badRequest, "Thiếu tham số `file`, `lineStart` hoặc `lineEnd`");
    }
    const blame = await blameLines(project.rootPath, run.currentRef, file, lineStart, lineEnd);
    return c.json(BlameResponseSchema.parse(blame));
  });

  return app;
}

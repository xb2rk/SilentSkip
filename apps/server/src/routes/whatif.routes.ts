import {
  AddPinRequestSchema,
  AskWhatIfRequestSchema,
  AskWhatIfResponseSchema,
  PinListResponseSchema,
  PinSchema,
  StartWhatIfSessionRequestSchema,
  WhatIfSessionDetailResponseSchema,
  WhatIfSessionListResponseSchema,
} from "@silentskip/contracts";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { WhatIfManager } from "../whatif";
import { readJsonBody } from "./utils";

export interface WhatIfRoutesDeps {
  readonly manager: WhatIfManager;
}

/**
 * What-If routes (E6): sessions of one A/B comparison, one SSE stream per answer, and the
 * comparison-scoped pins. Every response is parsed through the shared contract schemas.
 */
export function createWhatIfRoutes(deps: WhatIfRoutesDeps) {
  const app = new Hono();

  app.get("/sessions", (c) => {
    const projectId = c.req.query("projectId") ?? "";
    if (projectId === "") {
      return c.json({ sessions: [] });
    }
    const baseRef = c.req.query("base");
    const currentRef = c.req.query("current");
    const sessions = deps.manager.listSessions(projectId, baseRef, currentRef);
    return c.json(WhatIfSessionListResponseSchema.parse({ sessions }));
  });

  app.post("/sessions", async (c) => {
    const body = await readJsonBody(c.req.raw, StartWhatIfSessionRequestSchema);
    const detail = deps.manager.createSession(body);
    return c.json(WhatIfSessionDetailResponseSchema.parse(detail), 201);
  });

  app.get("/sessions/:sessionId", (c) => {
    const detail = deps.manager.getSession(c.req.param("sessionId"));
    return c.json(WhatIfSessionDetailResponseSchema.parse(detail));
  });

  app.post("/sessions/:sessionId/ask", async (c) => {
    const body = await readJsonBody(c.req.raw, AskWhatIfRequestSchema);
    const turnId = deps.manager.ask(c.req.param("sessionId"), body.question);
    return c.json(AskWhatIfResponseSchema.parse({ turnId }), 202);
  });

  app.get("/turns/:turnId/stream", (c) => {
    const channel = deps.manager.channel(c.req.param("turnId"));
    return streamSSE(c, async (stream) => {
      await channel.attach(async (event) => {
        await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      });
    });
  });

  app.get("/pins", (c) => {
    const projectId = c.req.query("projectId") ?? "";
    const baseRef = c.req.query("base") ?? "";
    const currentRef = c.req.query("current") ?? "";
    if (projectId === "" || baseRef === "" || currentRef === "") {
      return c.json({ pins: [] });
    }
    const pins = deps.manager.listPins(projectId, baseRef, currentRef);
    return c.json(PinListResponseSchema.parse({ pins }));
  });

  app.post("/pins", async (c) => {
    const body = await readJsonBody(c.req.raw, AddPinRequestSchema);
    const pin = await deps.manager.addPin(body);
    return c.json(PinSchema.parse(pin), 201);
  });

  app.delete("/pins/:pinId", (c) => {
    deps.manager.removePin(c.req.param("pinId"));
    return c.body(null, 204);
  });

  return app;
}

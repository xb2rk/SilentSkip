import {
  AddProjectRequestSchema,
  AppError,
  DiffSummarySchema,
  DigestBundleSchema,
  ErrorCodes,
  ProjectListResponseSchema,
  ProjectRefsResponseSchema,
  ProjectSummarySchema,
} from "@craftland-qa/contracts";
import type { AppDatabase } from "@craftland-qa/db";
import { Hono } from "hono";
import { loadDigest } from "../digest-input";
import { diffSummary, projectRefs } from "../git";
import { addProject, getProject, listProjects, removeProject } from "../projects";
import { readJsonBody } from "./utils";

/** Dependencies of the project routes. */
export interface ProjectsRoutesDeps {
  readonly db: AppDatabase;
}

/**
 * Project + git read routes (E1). Registration is manual: the user supplies an absolute
 * folder path and the server only checks protective filesystem facts — no detection.
 */
export function createProjectsRoutes(deps: ProjectsRoutesDeps): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const body = ProjectListResponseSchema.parse({ projects: listProjects(deps.db) });
    return c.json(body);
  });

  app.post("/", async (c) => {
    const input = await readJsonBody(c.req.raw, AddProjectRequestSchema);
    const project = addProject(deps.db, input.rootPath, input.name);
    return c.json(ProjectSummarySchema.parse(project), 201);
  });

  app.delete("/:id", (c) => {
    removeProject(deps.db, c.req.param("id"));
    return c.body(null, 204);
  });

  app.get("/:id/refs", async (c) => {
    const project = getProject(deps.db, c.req.param("id"));
    const refs = await projectRefs(project.rootPath);
    return c.json(ProjectRefsResponseSchema.parse(refs));
  });

  app.get("/:id/diff-summary", async (c) => {
    const project = getProject(deps.db, c.req.param("id"));
    const base = c.req.query("base");
    const current = c.req.query("current");
    if (base === undefined || base === "" || current === undefined || current === "") {
      throw new AppError(ErrorCodes.badRequest, "Thiếu tham số `base` hoặc `current`");
    }
    const summary = await diffSummary(project.rootPath, base, current);
    return c.json(DiffSummarySchema.parse(summary));
  });

  /** Digest v1 (E3): the deterministic fact sheet for an A/B range, computed on demand. */
  app.get("/:id/digest", async (c) => {
    const project = getProject(deps.db, c.req.param("id"));
    const base = c.req.query("base");
    const current = c.req.query("current");
    if (base === undefined || base === "" || current === undefined || current === "") {
      throw new AppError(ErrorCodes.badRequest, "Thiếu tham số `base` hoặc `current`");
    }
    const digest = await loadDigest(project.rootPath, base, current);
    return c.json(DigestBundleSchema.parse(digest));
  });

  return app;
}

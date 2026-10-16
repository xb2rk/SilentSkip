import {
  AddProjectRequestSchema,
  AppError,
  DetectProjectsRequestSchema,
  DetectProjectsResponseSchema,
  DiffSummarySchema,
  ErrorCodes,
  ProjectListResponseSchema,
  ProjectRefsResponseSchema,
  ProjectSummarySchema,
} from "@craftland-qa/contracts";
import type { AppDatabase } from "@craftland-qa/db";
import { Hono } from "hono";
import { diffSummary, projectRefs } from "../git";
import {
  addProject,
  detectProjectCandidates,
  getProject,
  listProjects,
  removeProject,
} from "../projects";
import { getSettings } from "../settings";
import { readJsonBody } from "./utils";

/** Dependencies of the project routes (db + allowed-roots seed). */
export interface ProjectsRoutesDeps {
  readonly db: AppDatabase;
  readonly defaultAllowedRoots: readonly string[];
}

/**
 * Project + git read routes (E1). Every filesystem/git access goes through the allowed-roots
 * boundary: detection and registration reject paths outside `allowedRoots`.
 */
export function createProjectsRoutes(deps: ProjectsRoutesDeps): Hono {
  const app = new Hono();

  const allowedRoots = (): string[] =>
    getSettings(deps.db, { allowedRoots: [...deps.defaultAllowedRoots] }).allowedRoots;

  app.get("/", (c) => {
    const body = ProjectListResponseSchema.parse({ projects: listProjects(deps.db) });
    return c.json(body);
  });

  app.post("/detect", async (c) => {
    const input = await readJsonBody(c.req.raw, DetectProjectsRequestSchema);
    const candidates = detectProjectCandidates(input.rootPath, allowedRoots());
    return c.json(DetectProjectsResponseSchema.parse({ candidates }));
  });

  app.post("/", async (c) => {
    const input = await readJsonBody(c.req.raw, AddProjectRequestSchema);
    const project = addProject(deps.db, input.rootPath, allowedRoots(), input.name);
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

  return app;
}

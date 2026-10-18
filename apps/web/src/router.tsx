import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { NotFoundPage } from "@/components/not-found";
import { ComparePage } from "@/pages/compare-page";
import { HistoryComparePage } from "@/pages/history-compare-page";
import { HistoryPage } from "@/pages/history-page";
import { LocalizationPage } from "@/pages/localization-page";
import { OverviewPage } from "@/pages/overview-page";
import { ProjectProfilePage } from "@/pages/project-profile-page";
import { RunPage } from "@/pages/run-page";
import { SettingsPage } from "@/pages/settings-page";
import { StatusPage } from "@/pages/status-page";
import { ToolsPage } from "@/pages/tools-page";
import { WhatIfPage } from "@/pages/what-if-page";

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: NotFoundPage,
});

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: OverviewPage,
});
const compareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/compare",
  validateSearch: (search: Record<string, unknown>) => {
    const parsed: {
      projectId?: string;
      base?: string;
      current?: string;
      preset?: "worktree" | "vs-main" | "custom";
      goal?: string;
    } = {};
    if (typeof search.projectId === "string") parsed.projectId = search.projectId;
    if (typeof search.base === "string") parsed.base = search.base;
    if (typeof search.current === "string") parsed.current = search.current;
    if (search.preset === "worktree" || search.preset === "vs-main" || search.preset === "custom") {
      parsed.preset = search.preset;
    }
    if (typeof search.goal === "string") parsed.goal = search.goal;
    return parsed;
  },
  component: ComparePage,
});
const whatIfRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/what-if",
  validateSearch: (search: Record<string, unknown>) => {
    const parsed: { projectId?: string; base?: string; current?: string; q?: string } = {};
    if (typeof search.projectId === "string") parsed.projectId = search.projectId;
    if (typeof search.base === "string") parsed.base = search.base;
    if (typeof search.current === "string") parsed.current = search.current;
    if (typeof search.q === "string") parsed.q = search.q;
    return parsed;
  },
  component: WhatIfPage,
});
const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/history",
  component: HistoryPage,
});
const historyCompareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/history/compare",
  validateSearch: (search: Record<string, unknown>) => {
    const parsed: { left?: string; right?: string } = {};
    if (typeof search.left === "string") parsed.left = search.left;
    if (typeof search.right === "string") parsed.right = search.right;
    return parsed;
  },
  component: HistoryComparePage,
});
const localizationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/localization",
  validateSearch: (search: Record<string, unknown>) => {
    const parsed: { projectId?: string; base?: string; current?: string } = {};
    if (typeof search.projectId === "string") parsed.projectId = search.projectId;
    if (typeof search.base === "string") parsed.base = search.base;
    if (typeof search.current === "string") parsed.current = search.current;
    return parsed;
  },
  component: LocalizationPage,
});
const runRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/runs/$runId",
  component: RunPage,
});
const toolsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tools",
  component: ToolsPage,
});
const projectProfileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/project",
  component: ProjectProfilePage,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});
const statusRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/status",
  component: StatusPage,
});

const routeTree = rootRoute.addChildren([
  overviewRoute,
  compareRoute,
  whatIfRoute,
  historyRoute,
  historyCompareRoute,
  localizationRoute,
  runRoute,
  toolsRoute,
  projectProfileRoute,
  settingsRoute,
  statusRoute,
]);

/**
 * Router instance. Routes are declared explicitly here (no file-based generation yet) so
 * the full screen map is visible in one file while the app is small.
 */
export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

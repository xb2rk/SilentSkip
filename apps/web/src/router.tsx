import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { NotFoundPage } from "@/components/not-found";
import { ComparePage } from "@/pages/compare-page";
import { HistoryPage } from "@/pages/history-page";
import { OverviewPage } from "@/pages/overview-page";
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
  component: ComparePage,
});
const whatIfRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/what-if",
  validateSearch: (search: Record<string, unknown>) => {
    const parsed: { projectId?: string; base?: string; current?: string } = {};
    if (typeof search.projectId === "string") parsed.projectId = search.projectId;
    if (typeof search.base === "string") parsed.base = search.base;
    if (typeof search.current === "string") parsed.current = search.current;
    return parsed;
  },
  component: WhatIfPage,
});
const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/history",
  component: HistoryPage,
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
  runRoute,
  toolsRoute,
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

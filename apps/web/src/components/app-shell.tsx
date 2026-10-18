import { PRODUCT_VERSION } from "@silentskip/contracts";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BookOpen,
  FolderGit2,
  GitCompareArrows,
  History,
  Languages,
  LayoutDashboard,
  Search,
  Settings as SettingsIcon,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CommandPalette } from "@/components/command-palette";
import { ProjectSwitcher } from "@/components/projects/project-switcher";
import { StatusIndicator } from "@/components/status-indicator";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useProject } from "@/contexts/project-context";

const NAV_GROUPS = [
  {
    labelKey: "nav.group.main",
    items: [
      { to: "/", labelKey: "nav.overview", icon: LayoutDashboard },
      { to: "/compare", labelKey: "nav.compare", icon: GitCompareArrows },
      { to: "/what-if", labelKey: "nav.whatIf", icon: Sparkles },
      { to: "/history", labelKey: "nav.history", icon: History },
      { to: "/localization", labelKey: "nav.localization", icon: Languages },
    ],
  },
  {
    labelKey: "nav.group.system",
    items: [
      { to: "/project", labelKey: "nav.projectProfile", icon: BookOpen },
      { to: "/status", labelKey: "nav.status", icon: Activity },
      { to: "/settings", labelKey: "nav.settings", icon: SettingsIcon },
    ],
  },
] as const;

/**
 * App shell: collapsible sidebar (icon rail, Sheet on mobile — Ctrl+B toggles), a nearly
 * empty sticky header (search + What-If icons, plus a status alert that only appears when
 * something is wrong), and the routed page in a stable, left-anchored content column.
 */
function readSidebarOpen(): boolean {
  try {
    const match = document.cookie.match(/(?:^|;\s*)sidebar_state=(true|false)/);
    return match === null ? true : match[1] === "true";
  } catch {
    return true;
  }
}

export function AppShell() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { activeProject } = useProject();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarDefaultOpen] = useState(readSidebarOpen);

  return (
    <SidebarProvider defaultOpen={sidebarDefaultOpen}>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link to="/">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Sparkles className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="truncate text-sm font-semibold">{t("app.product")}</span>
                    <span className="truncate text-micro text-muted-foreground">
                      v{PRODUCT_VERSION} · {t("app.tagline")}
                    </span>
                  </div>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>{t("projects.switcherLabel")}</SidebarGroupLabel>
            <ProjectSwitcher />
          </SidebarGroup>
          {NAV_GROUPS.map((group) => (
            <SidebarGroup key={group.labelKey}>
              <SidebarGroupLabel>{t(group.labelKey)}</SidebarGroupLabel>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive =
                    item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={t(item.labelKey)}>
                        <Link to={item.to}>
                          <item.icon />
                          <span>{t(item.labelKey)}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter>
          <div className="px-2 py-1 text-micro leading-4 text-muted-foreground group-data-[collapsible=icon]:hidden">
            {t("app.phase")}
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-background/80 px-4 backdrop-blur md:px-6 lg:px-8">
          <SidebarTrigger className="-ml-1" />
          {activeProject !== null && (
            <Link
              to="/compare"
              className="ml-1 hidden max-w-[220px] items-center gap-1.5 rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-meta text-muted-foreground transition-colors hover:text-foreground md:flex"
            >
              <FolderGit2 className="size-3.5 shrink-0" />
              <span className="truncate">{activeProject.name}</span>
            </Link>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  aria-label={t("header.searchTooltip")}
                  onClick={() => setPaletteOpen(true)}
                >
                  <Search className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("header.searchTooltip")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild variant="ghost" size="icon" className="size-8">
                  <Link to="/what-if" aria-label={t("header.whatIfTooltip")}>
                    <Sparkles className="size-4" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("header.whatIfTooltip")}</TooltipContent>
            </Tooltip>
            <StatusIndicator />
          </div>
        </header>
        <main className="flex-1">
          <div className="w-full max-w-6xl px-4 py-6 md:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </SidebarInset>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </SidebarProvider>
  );
}

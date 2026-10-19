import { PRODUCT_VERSION } from "@silentskip/contracts";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { cn } from "cn";
import {
  Activity,
  BookOpen,
  ChevronRight,
  FolderGit2,
  GitCompareArrows,
  History,
  Languages,
  LayoutDashboard,
  Moon,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
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
import { CopilotDrawer } from "@/components/whatif/copilot-drawer";
import { CopilotProvider, useCopilot } from "@/contexts/copilot-context";
import { useProject } from "@/contexts/project-context";
import { useTheme } from "@/contexts/theme-context";

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

function readSidebarOpen(): boolean {
  try {
    const match = document.cookie.match(/(?:^|;\s*)sidebar_state=(true|false)/);
    return match === null ? true : match[1] === "true";
  } catch {
    return true;
  }
}

function getBreadcrumbLabel(pathname: string): { parent?: string; title: string } {
  if (pathname === "/") return { title: "Tổng quan" };
  if (pathname === "/compare") return { title: "So sánh & Đánh giá" };
  if (pathname.startsWith("/runs/")) return { parent: "Lịch sử", title: "Báo cáo kiểm thử" };
  if (pathname === "/history/compare") return { parent: "Lịch sử", title: "So sánh 2 lần chạy" };
  if (pathname.startsWith("/history")) return { title: "Lịch sử kiểm định" };
  if (pathname.startsWith("/what-if")) return { title: "What-If Studio" };
  if (pathname.startsWith("/localization")) return { title: "Localization" };
  if (pathname.startsWith("/project")) return { title: "Hồ sơ dự án" };
  if (pathname.startsWith("/status")) return { title: "Trạng thái hệ thống" };
  if (pathname.startsWith("/settings")) return { title: "Cài đặt" };
  if (pathname.startsWith("/tools")) return { title: "Công cụ" };
  return { title: "SilentSkip" };
}

function AppShellInner() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { activeProject } = useProject();
  const { setTheme } = useTheme();
  const { openCopilot } = useCopilot();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarDefaultOpen] = useState(readSidebarOpen);

  const breadcrumb = getBreadcrumbLabel(pathname);

  function toggleTheme(): void {
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "light" : "dark");
  }

  return (
    <SidebarProvider defaultOpen={sidebarDefaultOpen}>
      <Sidebar collapsible="icon" className="border-r border-border/70">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link to="/">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
                    <Sparkles className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="truncate text-body font-bold">{t("app.product")}</span>
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
            <SidebarGroupLabel className="text-micro font-medium">
              {t("projects.switcherLabel")}
            </SidebarGroupLabel>
            <ProjectSwitcher />
          </SidebarGroup>
          {NAV_GROUPS.map((group) => (
            <SidebarGroup key={group.labelKey}>
              <SidebarGroupLabel className="text-micro font-medium">
                {t(group.labelKey)}
              </SidebarGroupLabel>
              <SidebarMenu>
                {group.items.map((item) => {
                  const isActive =
                    item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={t(item.labelKey)}
                        className={cn(
                          "transition-colors text-body",
                          isActive && "font-semibold text-primary bg-primary/10",
                        )}
                      >
                        <Link to={item.to}>
                          <item.icon className={cn("size-4", isActive && "text-primary")} />
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
        <SidebarFooter className="border-t border-sidebar-border/40 p-2">
          <div className="flex items-center gap-2 px-2 py-1 text-micro text-muted-foreground group-data-[collapsible=icon]:hidden">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            </span>
            <span className="truncate font-medium">{t("app.phase")}</span>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-border/60 bg-background/85 px-4 backdrop-blur md:px-6 lg:px-8">
          <SidebarTrigger className="-ml-1" />

          {/* Breadcrumbs */}
          <div className="hidden sm:flex items-center gap-2 text-meta text-muted-foreground">
            {activeProject !== null && (
              <Link
                to="/compare"
                className="flex items-center gap-1.5 font-medium text-foreground/80 hover:text-foreground transition-colors"
              >
                <FolderGit2 className="size-3.5 text-primary" />
                <span className="max-w-[140px] truncate">{activeProject.name}</span>
              </Link>
            )}
            {activeProject !== null && (
              <ChevronRight className="size-3.5 text-muted-foreground/60" />
            )}
            {breadcrumb.parent && (
              <>
                <span>{breadcrumb.parent}</span>
                <ChevronRight className="size-3.5 text-muted-foreground/60" />
              </>
            )}
            <span className="font-semibold text-foreground">{breadcrumb.title}</span>
          </div>

          {/* Right Header Actions */}
          <div className="ml-auto flex items-center gap-2">
            {/* Command Search Pill */}
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="hidden md:flex items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-1.5 text-meta text-muted-foreground hover:bg-muted hover:text-foreground transition-all w-48 lg:w-56"
              aria-label={t("header.searchTooltip")}
            >
              <Search className="size-3.5 shrink-0" />
              <span className="flex-1 text-left truncate">{t("command.placeholder")}</span>
              <kbd className="pointer-events-none inline-flex h-4 select-none items-center gap-0.5 rounded border border-border/80 bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                Ctrl K
              </kbd>
            </button>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 md:hidden text-muted-foreground hover:text-foreground"
                  aria-label={t("header.searchTooltip")}
                  onClick={() => setPaletteOpen(true)}
                >
                  <Search className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("header.searchTooltip")}</TooltipContent>
            </Tooltip>

            {/* Quick Theme Switcher */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-foreground"
                  onClick={toggleTheme}
                  aria-label="Toggle theme"
                >
                  <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                  <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Đổi giao diện Sáng / Tối</TooltipContent>
            </Tooltip>

            {/* Copilot Drawer Trigger */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary hover:text-primary transition-all text-xs font-semibold px-2.5"
                  onClick={() => openCopilot()}
                >
                  <Sparkles className="size-3.5 text-primary" />
                  <span className="hidden sm:inline">Copilot</span>
                  <kbd className="pointer-events-none ml-1 hidden lg:inline-flex h-3.5 select-none items-center rounded border border-primary/20 bg-primary/10 px-1 font-mono text-[9px] text-primary">
                    Ctrl /
                  </kbd>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Mở SilentSkip Copilot (Ctrl + /)</TooltipContent>
            </Tooltip>

            <StatusIndicator />
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1">
          <div className="w-full max-w-7xl px-4 py-6 md:px-6 lg:px-8">
            <Outlet />
          </div>
        </main>
      </SidebarInset>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <CopilotDrawer />
    </SidebarProvider>
  );
}

export function AppShell() {
  return (
    <CopilotProvider>
      <AppShellInner />
    </CopilotProvider>
  );
}

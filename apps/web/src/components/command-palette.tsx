import { useNavigate } from "@tanstack/react-router";
import {
  Activity,
  Check,
  FolderGit2,
  GitCompareArrows,
  History,
  LayoutDashboard,
  Monitor,
  Moon,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
} from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useProject } from "@/contexts/project-context";
import { useTheme } from "@/contexts/theme-context";
import { formatDateTime } from "@/lib/format";
import { useRuns } from "@/lib/use-runs";

const PAGES = [
  { to: "/", labelKey: "nav.overview", icon: LayoutDashboard },
  { to: "/compare", labelKey: "nav.compare", icon: GitCompareArrows },
  { to: "/what-if", labelKey: "nav.whatIf", icon: Sparkles },
  { to: "/history", labelKey: "nav.history", icon: History },
  { to: "/status", labelKey: "nav.status", icon: Activity },
  { to: "/settings", labelKey: "nav.settings", icon: SettingsIcon },
] as const;

interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Global command palette (Ctrl+K). Also owns two global shortcuts: Ctrl+K toggles the
 * palette and Ctrl+/ jumps straight to What-If. Controlled by AppShell so the header
 * button and the keyboard shortcut share one piece of state.
 */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setTheme } = useTheme();
  const { projects, activeProjectId, setActiveProjectId } = useProject();
  const runsQuery = useRuns(null);
  const recentRuns = (runsQuery.data?.runs ?? []).slice(0, 6);
  const projectName = (projectId: string): string =>
    projects.find((project) => project.id === projectId)?.name ?? projectId.slice(0, 8);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "/") {
        event.preventDefault();
        void navigate({ to: "/what-if" });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, onOpenChange, open]);

  function goTo(to: (typeof PAGES)[number]["to"]): void {
    onOpenChange(false);
    void navigate({ to });
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder={t("command.placeholder")} />
      <CommandList>
        <CommandEmpty>{t("command.empty")}</CommandEmpty>
        <CommandGroup heading={t("command.groupNavigation")}>
          {PAGES.map((page) => (
            <CommandItem
              key={page.to}
              value={`${t(page.labelKey)} ${page.to}`}
              onSelect={() => goTo(page.to)}
            >
              <page.icon className="size-4" />
              <span>{t(page.labelKey)}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        {projects.length > 0 && (
          <CommandGroup heading={t("command.groupProjects")}>
            {projects.map((project) => (
              <CommandItem
                key={project.id}
                value={`${project.name} ${project.rootPath} ${project.id}`}
                onSelect={() => {
                  onOpenChange(false);
                  setActiveProjectId(project.id);
                  void navigate({ to: "/compare" });
                }}
              >
                <FolderGit2 className="size-4" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{project.name}</span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {project.rootPath}
                  </span>
                </span>
                {project.id === activeProjectId && <Check className="size-4 text-primary" />}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {recentRuns.length > 0 && (
          <CommandGroup heading={t("command.groupRuns")}>
            {recentRuns.map((run) => (
              <CommandItem
                key={run.id}
                value={`${run.id} ${projectName(run.projectId)} ${run.baseRef} ${run.currentRef}`}
                onSelect={() => {
                  onOpenChange(false);
                  void navigate({ to: "/runs/$runId", params: { runId: run.id } });
                }}
              >
                <History className="size-4" />
                <span className="truncate font-mono text-[11.5px]">
                  {projectName(run.projectId)} · {run.baseRef} → {run.currentRef}
                </span>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                  {formatDateTime(run.createdAt)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading={t("command.groupAppearance")}>
          <CommandItem value={t("command.themeLight")} onSelect={() => setTheme("light")}>
            <Sun className="size-4" />
            <span>{t("command.themeLight")}</span>
          </CommandItem>
          <CommandItem value={t("command.themeDark")} onSelect={() => setTheme("dark")}>
            <Moon className="size-4" />
            <span>{t("command.themeDark")}</span>
          </CommandItem>
          <CommandItem value={t("command.themeSystem")} onSelect={() => setTheme("system")}>
            <Monitor className="size-4" />
            <span>{t("command.themeSystem")}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

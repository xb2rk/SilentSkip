import { Check, ChevronsUpDown, FolderGit2, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AddProjectDialog } from "@/components/projects/add-project-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useProject } from "@/contexts/project-context";

/**
 * Sidebar project switcher: shows the active project, switches between registered projects
 * and opens the add-project dialog. Collapses to an icon rail together with the sidebar.
 */
export function ProjectSwitcher() {
  const { t } = useTranslation();
  const { projects, isLoading, activeProject, setActiveProjectId } = useProject();
  const [addOpen, setAddOpen] = useState(false);

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton size="lg" tooltip={t("projects.switcherLabel")}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg border border-border/60 bg-muted/60">
                  <FolderGit2 className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="truncate text-body font-medium">
                    {isLoading
                      ? t("projects.loadingSwitcher")
                      : (activeProject?.name ?? t("projects.selectPrompt"))}
                  </span>
                  <span className="truncate text-micro text-muted-foreground">
                    {t("projects.switcherLabel")}
                    {projects.length > 0 ? ` · ${projects.length}` : ""}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="max-h-96 w-64 overflow-y-auto"
              align="start"
              side="right"
              sideOffset={8}
            >
              <DropdownMenuLabel>{t("projects.switcherLabel")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {projects.map((project) => (
                <DropdownMenuItem
                  key={project.id}
                  onClick={() => setActiveProjectId(project.id)}
                  className="gap-2"
                >
                  <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{project.name}</span>
                    <span className="truncate text-micro text-muted-foreground">
                      {project.rootPath}
                    </span>
                  </span>
                  {project.id === activeProject?.id && (
                    <Check className="size-4 shrink-0 text-primary" />
                  )}
                </DropdownMenuItem>
              ))}
              {projects.length === 0 && (
                <DropdownMenuItem disabled className="text-muted-foreground">
                  {t("projects.emptySwitcher")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setAddOpen(true)}>
                <Plus className="size-4" />
                {t("projects.addProject")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <AddProjectDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={(project) => setActiveProjectId(project.id)}
      />
    </>
  );
}

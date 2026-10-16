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
  const { projects, activeProject, setActiveProjectId } = useProject();
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
                  <span className="truncate text-[13px] font-medium">
                    {activeProject?.name ?? t("projects.selectPrompt")}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {t("projects.switcherLabel")}
                    {projects.length > 0 ? ` · ${projects.length}` : ""}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64" align="start" side="right" sideOffset={8}>
              <DropdownMenuLabel>{t("projects.switcherLabel")}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {projects.map((project) => (
                <DropdownMenuItem
                  key={project.id}
                  onClick={() => setActiveProjectId(project.id)}
                  className="gap-2"
                >
                  <FolderGit2 className="size-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{project.name}</span>
                  {project.id === activeProject?.id && <Check className="size-4 text-primary" />}
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

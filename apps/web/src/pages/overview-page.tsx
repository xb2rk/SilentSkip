import type { ProjectSummary } from "@silentskip/contracts";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
  Check,
  ChevronDown,
  Copy,
  FolderGit2,
  FolderPlus,
  GitBranch,
  GitCompareArrows,
  History,
  ListChecks,
  Plus,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { AddProjectDialog } from "@/components/projects/add-project-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopilot } from "@/contexts/copilot-context";
import { useProject } from "@/contexts/project-context";
import { useProjectRefs, useRemoveProject } from "@/lib/use-projects";

const STEPS = [
  {
    icon: FolderPlus,
    titleKey: "overview.step1Title",
    descriptionKey: "overview.step1Description",
  },
  {
    icon: GitCompareArrows,
    titleKey: "overview.step2Title",
    descriptionKey: "overview.step2Description",
  },
  {
    icon: ListChecks,
    titleKey: "overview.step3Title",
    descriptionKey: "overview.step3Description",
  },
] as const;

interface ProjectCardProps {
  readonly project: ProjectSummary;
  readonly isActive: boolean;
  readonly onSelect: () => void;
}

/** Redesigned modern interactive project card */
function ProjectCard({ project, isActive, onSelect }: ProjectCardProps) {
  const { t } = useTranslation();
  const remove = useRemoveProject();
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(project.rootPath);
      setCopied(true);
      toast.success(t("common.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("common.copyFailed"));
    }
  }

  return (
    <div
      className={cn(
        "surface-interactive flex flex-col justify-between p-5 gap-4 relative group",
        isActive && "border-primary/50 shadow-md ring-1 ring-primary/20",
      )}
    >
      <div className="space-y-3">
        {/* Top Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              <FolderGit2 className="size-4" />
            </div>
            <span className="truncate text-body-lg font-bold text-foreground">{project.name}</span>
          </div>

          {isActive ? (
            <Badge className="shrink-0 bg-positive/15 text-positive hover:bg-positive/20 border-0 gap-1.5 font-medium px-2 py-0.5">
              <span className="size-1.5 rounded-full bg-positive animate-pulse" />
              {t("projects.activeBadge")}
            </Badge>
          ) : null}
        </div>

        {/* Path Bar with Copy Button */}
        <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/40 px-2.5 py-1.5 text-meta text-muted-foreground">
          <span className="truncate font-mono text-micro select-all mr-2" title={project.rootPath}>
            {project.rootPath}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void handleCopy();
            }}
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-0.5"
            title="Sao chép đường dẫn"
          >
            {copied ? <Check className="size-3.5 text-positive" /> : <Copy className="size-3.5" />}
          </button>
        </div>
      </div>

      {/* Action Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-border/40">
        {isActive ? (
          <span className="text-micro font-medium text-primary">✓ {t("projects.activeHint")}</span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs font-semibold"
            onClick={onSelect}
          >
            {t("projects.useProject")}
          </Button>
        )}

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10"
              aria-label={t("projects.remove")}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("projects.removeTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("projects.removeDescription")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  remove.mutate(project.id, {
                    onSuccess: () => toast.success(t("projects.removed")),
                    onError: () => toast.error(t("projects.removeFailed")),
                  })
                }
              >
                {t("projects.remove")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

/**
 * Modern Overview Home screen:
 * - Active Project Status Hero Deck
 * - Clean Project Grid
 * - Collapsible / friendly onboarding guide
 */
export function OverviewPage() {
  const { t } = useTranslation();
  const { projects, isLoading, isError, retry, activeProject, setActiveProjectId } = useProject();
  const { openCopilot } = useCopilot();
  const [addOpen, setAddOpen] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  const activeRefsQuery = useProjectRefs(activeProject?.id ?? null);
  const currentBranch = activeRefsQuery.data?.head?.branch ?? "main";

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("overview.title")}
        description={t("overview.description")}
        actions={
          <Button onClick={() => setAddOpen(true)} className="gap-2 shadow-xs">
            <Plus className="size-4" />
            {t("overview.addProject")}
          </Button>
        }
      />

      {isError ? (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertTitle>{t("errors.loadTitle")}</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{t("errors.loadDescription")}</p>
            <Button variant="outline" size="sm" onClick={retry}>
              {t("common.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
        </div>
      ) : projects.length === 0 ? (
        /* Empty State */
        <div className="surface flex flex-col items-center gap-6 p-12 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-xs">
            <FolderPlus className="size-6" />
          </div>
          <div className="space-y-2 max-w-md">
            <h2 className="text-xl font-bold tracking-tight">{t("overview.startTitle")}</h2>
            <p className="text-body leading-relaxed text-muted-foreground">
              {t("overview.startDescription")}
            </p>
          </div>
          <Button size="lg" onClick={() => setAddOpen(true)} className="gap-2 font-semibold">
            <FolderPlus className="size-4" />
            {t("overview.addProject")}
          </Button>
        </div>
      ) : (
        <>
          {/* Active Project Hero Status Deck */}
          {activeProject && (
            <div className="surface relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-card via-card to-primary/[0.04] p-6 shadow-sm">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary shadow-xs">
                      <FolderGit2 className="size-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-xl font-bold tracking-tight text-foreground">
                          {activeProject.name}
                        </h2>
                        <Badge className="bg-positive/15 text-positive border-0 gap-1 font-medium text-xs">
                          <span className="size-1.5 rounded-full bg-positive" />
                          Đang kích hoạt
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-meta text-muted-foreground font-mono mt-0.5">
                        <GitBranch className="size-3 text-primary shrink-0" />
                        <span>{currentBranch}</span>
                        <span>·</span>
                        <span className="truncate max-w-sm" title={activeProject.rootPath}>
                          {activeProject.rootPath}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 shrink-0 pt-2 lg:pt-0">
                  <Button asChild size="default" className="gap-2 font-semibold shadow-xs">
                    <Link to="/compare" search={{ projectId: activeProject.id }}>
                      <GitCompareArrows className="size-4" />
                      {t("projects.quickCompare")}
                    </Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="default"
                    className="gap-2 font-semibold"
                    onClick={() =>
                      openCopilot({
                        projectId: activeProject.id,
                        initialQuestion: `Tôi muốn hỏi về dự án ${activeProject.name}`,
                      })
                    }
                  >
                    <Sparkles className="size-4 text-primary" />
                    Hỏi Copilot
                  </Button>
                  <Button asChild variant="ghost" size="default" className="gap-2">
                    <Link to="/history">
                      <History className="size-4 text-muted-foreground" />
                      Lịch sử
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Connected Projects Grid */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <h2 className="text-body-lg font-bold text-foreground flex items-center gap-2">
                <span>{t("projects.listTitle")}</span>
                <Badge variant="secondary" className="font-normal text-xs">
                  {projects.length}
                </Badge>
              </h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  isActive={project.id === activeProject?.id}
                  onSelect={() => setActiveProjectId(project.id)}
                />
              ))}

              {/* Add Project Action Card */}
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="surface-interactive flex min-h-40 flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-border/80 p-5 text-muted-foreground transition-all hover:border-primary/50 hover:text-foreground group"
              >
                <div className="flex size-10 items-center justify-center rounded-xl bg-muted transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                  <Plus className="size-5" />
                </div>
                <div className="text-center space-y-0.5">
                  <span className="text-body font-semibold text-foreground group-hover:text-primary transition-colors">
                    {t("projects.addCard")}
                  </span>
                  <p className="text-micro text-muted-foreground">Kết nối thêm thư mục game</p>
                </div>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Collapsible Onboarding Steps Guide */}
      {projects.length > 0 && (
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowSteps((prev) => !prev)}
            className="flex items-center gap-2 text-meta text-muted-foreground hover:text-foreground transition-colors font-medium"
          >
            <ChevronDown className={cn("size-4 transition-transform", showSteps && "rotate-180")} />
            <span>Hướng dẫn quy trình 3 bước so sánh & kiểm định</span>
          </button>

          {showSteps && (
            <div className="surface mt-3 p-5">
              <div className="grid gap-4 sm:grid-cols-3">
                {STEPS.map((step, index) => (
                  <div key={step.titleKey} className="flex items-start gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {index + 1}
                    </div>
                    <div className="space-y-1">
                      <p className="text-body font-semibold text-foreground">{t(step.titleKey)}</p>
                      <p className="text-meta leading-relaxed text-muted-foreground">
                        {t(step.descriptionKey)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <AddProjectDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={(project) => setActiveProjectId(project.id)}
      />
    </div>
  );
}

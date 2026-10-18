import type { ProjectSummary } from "@craftland-qa/contracts";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
  FolderGit2,
  FolderPlus,
  GitCompareArrows,
  ListChecks,
  ShieldAlert,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useProject } from "@/contexts/project-context";
import { useRemoveProject } from "@/lib/use-projects";

const FEATURES = [
  {
    icon: GitCompareArrows,
    titleKey: "overview.features.compareTitle",
    descriptionKey: "overview.features.compareDescription",
  },
  {
    icon: ShieldAlert,
    titleKey: "overview.features.mismatchTitle",
    descriptionKey: "overview.features.mismatchDescription",
  },
  {
    icon: Sparkles,
    titleKey: "overview.features.whatIfTitle",
    descriptionKey: "overview.features.whatIfDescription",
  },
] as const;

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

/** One registered project: name, clickable path (copy), active state, use/remove actions. */
function ProjectCard({ project, isActive, onSelect }: ProjectCardProps) {
  const { t } = useTranslation();
  const remove = useRemoveProject();

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(project.rootPath);
      toast.success(t("common.copied"));
    } catch {
      toast.error(t("common.copyFailed"));
    }
  }

  return (
    <Card className={cn("py-5", isActive && "border-primary/50")}>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
              <FolderGit2 className="size-4" />
            </div>
            <span className="truncate text-[13px] font-semibold">{project.name}</span>
          </div>
          {isActive && (
            <Badge variant="secondary" className="shrink-0 font-normal text-primary">
              {t("projects.activeBadge")}
            </Badge>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleCopy()}
          title={project.rootPath}
          className="block w-full truncate rounded-md border border-border/60 bg-muted/40 px-2 py-1.5 text-left font-mono text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {project.rootPath}
        </button>
        <div className="flex items-center justify-between gap-2">
          {isActive ? (
            <span className="text-[11.5px] text-muted-foreground">{t("projects.activeHint")}</span>
          ) : (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onSelect}>
              {t("projects.useProject")}
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
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
      </CardContent>
    </Card>
  );
}

/**
 * Home screen. Zero projects → onboarding only. With projects: spotlight (active project +
 * quick actions) and the project grid; the "how it works" card stays as orientation.
 */
export function OverviewPage() {
  const { t } = useTranslation();
  const { projects, isLoading, isError, retry, activeProject, setActiveProjectId } = useProject();
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader title={t("overview.title")} description={t("overview.description")} />

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
        <Card>
          <CardContent className="flex flex-col items-center gap-6 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <FolderPlus className="size-5" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold">{t("overview.startTitle")}</h2>
              <p className="mx-auto max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
                {t("overview.startDescription")}
              </p>
            </div>
            <Button onClick={() => setAddOpen(true)}>
              <FolderPlus className="size-4" />
              {t("overview.addProject")}
            </Button>
            <Separator className="max-w-2xl" />
            <div className="grid w-full max-w-3xl gap-4 text-left sm:grid-cols-3">
              {FEATURES.map((feature) => (
                <div
                  key={feature.titleKey}
                  className="flex flex-col items-start gap-2 rounded-lg border border-border/60 p-4"
                >
                  <div className="flex size-8 items-center justify-center rounded-md bg-muted text-foreground">
                    <feature.icon className="size-4" />
                  </div>
                  <p className="text-[13px] font-semibold">{t(feature.titleKey)}</p>
                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                    {t(feature.descriptionKey)}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <h2 className="text-[15px] font-semibold">
                  {t("projects.spotlightTitle", { name: activeProject?.name ?? "" })}
                </h2>
                <p className="text-[12.5px] text-muted-foreground">
                  {t("projects.spotlightDescription")}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button asChild>
                  <Link to="/compare">
                    <GitCompareArrows className="size-4" />
                    {t("projects.quickCompare")}
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/what-if">
                    <Sparkles className="size-4" />
                    {t("projects.quickWhatIf")}
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-3">
            <h2 className="text-[15px] font-semibold">{t("projects.listTitle")}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  isActive={project.id === activeProject?.id}
                  onSelect={() => setActiveProjectId(project.id)}
                />
              ))}
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 p-4 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                  <FolderPlus className="size-4" />
                </div>
                <span className="text-[12.5px] font-medium">{t("projects.addCard")}</span>
              </button>
            </div>
          </div>
        </>
      )}

      {!isLoading && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("overview.stepsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <div key={step.titleKey} className="flex items-start gap-3">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {index + 1}
                </div>
                <div className="space-y-0.5">
                  <p className="text-[13px] font-semibold">{t(step.titleKey)}</p>
                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                    {t(step.descriptionKey)}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <AddProjectDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={(project) => setActiveProjectId(project.id)}
      />
    </div>
  );
}

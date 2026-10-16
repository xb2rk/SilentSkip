import {
  AppError,
  ErrorCodes,
  type ProjectCandidate,
  type ProjectSummary,
} from "@craftland-qa/contracts";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { Check, FolderSearch, Loader2, Settings as SettingsIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAddProject, useDetectProjects } from "@/lib/use-projects";

/**
 * Add-project dialog: point at a folder, detect Craftland projects inside it (the server
 * shows marker evidence), then register one. All reads stay inside allowed roots — when the
 * folder is not allowed yet, the dialog links straight to the Settings section.
 */

interface AddProjectDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onAdded?: (project: ProjectSummary) => void;
}

function MarkerBadges({ candidate }: { readonly candidate: ProjectCandidate }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {candidate.markers.gprojFiles.length > 0 && (
        <Badge variant="secondary" className="font-normal">
          {t("projects.markerGproj")}
        </Badge>
      )}
      {candidate.markers.hasCsvDir && (
        <Badge variant="secondary" className="font-normal">
          {t("projects.markerCsv")}
        </Badge>
      )}
      {candidate.markers.hasScriptsDir && (
        <Badge variant="secondary" className="font-normal">
          {t("projects.markerScripts")}
        </Badge>
      )}
      {candidate.markers.isGitRepo && (
        <Badge variant="secondary" className="font-normal">
          {t("projects.markerGit")}
        </Badge>
      )}
      {candidate.markers.fcFileSample !== null && (
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {candidate.markers.fcFileSample}
        </span>
      )}
    </div>
  );
}

export function AddProjectDialog({ open, onOpenChange, onAdded }: AddProjectDialogProps) {
  const { t } = useTranslation();
  const detect = useDetectProjects();
  const add = useAddProject();
  const [rootPath, setRootPath] = useState("");
  const [selected, setSelected] = useState<ProjectCandidate | null>(null);
  const [name, setName] = useState("");

  const notAllowed =
    detect.error instanceof AppError && detect.error.code === ErrorCodes.pathNotAllowed;
  const notFound = detect.error instanceof AppError && detect.error.code === ErrorCodes.notFound;

  function handleDetect(): void {
    setSelected(null);
    detect.mutate(rootPath.trim());
  }

  function handleAdd(): void {
    if (selected === null) return;
    add.mutate(
      {
        rootPath: selected.rootPath,
        ...(name.trim() === "" ? {} : { name: name.trim() }),
      },
      {
        onSuccess: (project) => {
          toast.success(t("projects.added", { name: project.name }));
          onAdded?.(project);
          onOpenChange(false);
          setRootPath("");
          setSelected(null);
          setName("");
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("projects.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("projects.dialogDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="project-root">{t("projects.pathLabel")}</Label>
            <div className="flex gap-2">
              <Input
                id="project-root"
                value={rootPath}
                onChange={(event) => setRootPath(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleDetect();
                }}
                placeholder={t("projects.pathPlaceholder")}
                className="flex-1 font-mono text-[12.5px]"
              />
              <Button
                variant="outline"
                onClick={handleDetect}
                disabled={rootPath.trim() === "" || detect.isPending}
              >
                {detect.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FolderSearch className="size-4" />
                )}
                {detect.isPending ? t("projects.detecting") : t("projects.detect")}
              </Button>
            </div>
          </div>

          {detect.isError && (
            <Alert variant="destructive">
              <AlertDescription className="space-y-2">
                <p>
                  {notAllowed
                    ? t("projects.notAllowedDescription")
                    : notFound
                      ? t("projects.notFound")
                      : detect.error.message}
                </p>
                {notAllowed && (
                  <Button asChild variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                    <Link to="/settings">
                      <SettingsIcon className="size-4" />
                      {t("projects.openSettings")}
                    </Link>
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          {detect.isSuccess &&
            (detect.data.candidates.length === 0 ? (
              <p className="rounded-lg border border-border/60 bg-muted/40 p-3 text-[12.5px] text-muted-foreground">
                {t("projects.candidatesEmpty")}
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-[12.5px] font-medium">
                  {t("projects.candidatesTitle", { count: detect.data.candidates.length })}
                </p>
                {detect.data.candidates.map((candidate) => {
                  const isSelected = selected?.rootPath === candidate.rootPath;
                  return (
                    <button
                      key={candidate.rootPath}
                      type="button"
                      onClick={() => {
                        setSelected(candidate);
                        if (name === "") setName(candidate.name);
                      }}
                      className={cn(
                        "w-full rounded-lg border p-3 text-left transition-colors",
                        isSelected
                          ? "border-primary/60 bg-primary/5"
                          : "border-border/60 hover:bg-accent/40",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-medium">{candidate.name}</span>
                        {isSelected && <Check className="size-4 text-primary" />}
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[11.5px] text-muted-foreground">
                        {candidate.rootPath}
                      </p>
                      <div className="mt-2">
                        <MarkerBadges candidate={candidate} />
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}

          {selected !== null && (
            <div className="space-y-2">
              <Label htmlFor="project-name">{t("projects.nameLabel")}</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleAdd} disabled={selected === null || add.isPending}>
            {add.isPending && <Loader2 className="size-4 animate-spin" />}
            {t("projects.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

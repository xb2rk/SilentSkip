import type { ProjectSummary } from "@craftland-qa/contracts";
import { FolderOpen, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FolderBrowserDialog } from "@/components/projects/folder-browser-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { pushRecentPath, readRecentPaths } from "@/lib/recent-paths";
import { useAddProject } from "@/lib/use-projects";

/**
 * Add-project dialog. Registration is manual: pick the exact folder (typed or via the
 * read-only folder browser) and confirm — no detection, no guessed classification.
 */

interface AddProjectDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onAdded?: (project: ProjectSummary) => void;
}

export function AddProjectDialog({ open, onOpenChange, onAdded }: AddProjectDialogProps) {
  const { t } = useTranslation();
  const add = useAddProject();
  const [rootPath, setRootPath] = useState("");
  const [name, setName] = useState("");
  const [browserOpen, setBrowserOpen] = useState(false);
  const [recent, setRecent] = useState<readonly string[]>(() => readRecentPaths());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleAdd(): void {
    setErrorMessage(null);
    add.mutate(
      {
        rootPath: rootPath.trim(),
        ...(name.trim() === "" ? {} : { name: name.trim() }),
      },
      {
        onSuccess: (project) => {
          toast.success(t("projects.added", { name: project.name }));
          pushRecentPath(project.rootPath);
          setRecent(readRecentPaths());
          onAdded?.(project);
          onOpenChange(false);
          setRootPath("");
          setName("");
        },
        onError: (error) => setErrorMessage(error instanceof Error ? error.message : String(error)),
      },
    );
  }

  return (
    <>
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
                    if (event.key === "Enter" && rootPath.trim() !== "") handleAdd();
                  }}
                  placeholder={t("projects.pathPlaceholder")}
                  className="min-w-0 flex-1 font-mono text-[12.5px]"
                />
                <Button type="button" variant="outline" onClick={() => setBrowserOpen(true)}>
                  <FolderOpen className="size-4" />
                  {t("projects.browse")}
                </Button>
              </div>
            </div>

            {recent.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-muted-foreground">{t("projects.recent")}</span>
                {recent.map((recentPath) => (
                  <button
                    key={recentPath}
                    type="button"
                    title={recentPath}
                    onClick={() => setRootPath(recentPath)}
                    className="max-w-56 truncate rounded-full border border-border/60 px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {recentPath}
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="project-name">{t("projects.nameLabel")}</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("projects.namePlaceholder")}
              />
            </div>

            {errorMessage !== null && (
              <Alert variant="destructive">
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={handleAdd}
              disabled={rootPath.trim() === "" || add.isPending}
            >
              {add.isPending && <Loader2 className="size-4 animate-spin" />}
              {t("projects.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <FolderBrowserDialog
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        onSelect={setRootPath}
        initialPath={rootPath.trim() === "" ? undefined : rootPath.trim()}
      />
    </>
  );
}

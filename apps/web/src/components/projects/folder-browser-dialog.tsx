import { ChevronUp, Folder, HardDrive } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useFsList } from "@/lib/use-projects";

interface FolderBrowserDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (path: string) => void;
  readonly initialPath?: string | undefined;
}

/**
 * Read-only folder picker: navigate one directory level at a time (drive roots at the
 * top), then confirm the current folder. Plain navigation — no scanning, no heuristics.
 */
export function FolderBrowserDialog({
  open,
  onOpenChange,
  onSelect,
  initialPath,
}: FolderBrowserDialogProps) {
  const { t } = useTranslation();
  const [path, setPath] = useState<string | null>(initialPath ?? null);

  useEffect(() => {
    if (open) {
      setPath(initialPath ?? null);
    }
  }, [open, initialPath]);

  const listing = useFsList(path);
  const data = listing.data;
  const atDrives = data !== undefined && data.path === null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("folderBrowser.title")}</DialogTitle>
          <DialogDescription>{t("folderBrowser.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={data === undefined || data.parent === null}
            onClick={() => {
              const parent = data?.parent ?? null;
              if (parent !== null) setPath(parent);
            }}
          >
            <ChevronUp className="size-4" />
            {t("folderBrowser.up")}
          </Button>
          <code
            className="min-w-0 flex-1 truncate rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-[11.5px] text-muted-foreground"
            title={data?.path ?? t("folderBrowser.drivesTitle")}
          >
            {data?.path ?? t("folderBrowser.drivesTitle")}
          </code>
        </div>

        <div className="h-64 overflow-y-auto rounded-lg border border-border/60">
          {listing.isPending ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : listing.isError ? (
            <div className="space-y-3 p-3">
              <p className="text-[12.5px] text-destructive">
                {listing.error instanceof Error ? listing.error.message : String(listing.error)}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => setPath(null)}>
                {t("folderBrowser.backToDrives")}
              </Button>
            </div>
          ) : data === undefined ? null : data.directories.length === 0 ? (
            <p className="p-3 text-[12.5px] text-muted-foreground">{t("folderBrowser.empty")}</p>
          ) : (
            data.directories.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => setPath(entry.path)}
                className="flex w-full items-center gap-2 border-b border-border/40 px-3 py-2 text-left text-[12.5px] transition-colors last:border-0 hover:bg-accent/40"
              >
                {atDrives ? (
                  <HardDrive className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 truncate" title={entry.name}>
                  {entry.name}
                </span>
              </button>
            ))
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={data?.path == null}
            onClick={() => {
              const selected = data?.path ?? null;
              if (selected !== null) {
                onSelect(selected);
                onOpenChange(false);
              }
            }}
          >
            {t("folderBrowser.select")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

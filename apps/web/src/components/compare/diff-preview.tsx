import type { DiffFileEntry, DiffFileStatus } from "@silentskip/contracts";
import { cn } from "cn";
import { Search } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export const STATUS_STYLES: Record<DiffFileStatus, string> = {
  A: "bg-positive/15 text-positive dark:text-positive",
  M: "bg-warning/15 text-warning dark:text-warning",
  D: "bg-danger/15 text-danger dark:text-danger",
  R: "bg-info/15 text-info dark:text-info",
  U: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
};

export const STATUS_LABEL_KEYS: Record<DiffFileStatus, string> = {
  A: "compare.statusAdded",
  M: "compare.statusModified",
  D: "compare.statusDeleted",
  R: "compare.statusRenamed",
  U: "compare.statusUntracked",
};

export const KIND_LABEL_KEYS: Record<DiffFileEntry["kind"], string> = {
  csv: "compare.kindCsv",
  script: "compare.kindScript",
  other: "compare.kindOther",
};

export function StatusBadge({ status }: { readonly status: DiffFileStatus }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-micro font-medium",
        STATUS_STYLES[status],
      )}
    >
      {t(STATUS_LABEL_KEYS[status])}
    </span>
  );
}

export interface DiffPreviewProps {
  readonly files: readonly DiffFileEntry[];
  readonly additions: number;
  readonly deletions: number;
  readonly untrackedFiles: number;
  readonly scriptFiles: number;
  readonly csvFiles: number;
}

const MAX_DIFF_ROWS = 100;

export function DiffPreview({
  files,
  additions,
  deletions,
  untrackedFiles,
  scriptFiles,
  csvFiles,
}: DiffPreviewProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterKind, setFilterKind] = useState<"all" | "script" | "csv" | "untracked">("all");

  if (files.length === 0) {
    return <p className="text-body text-muted-foreground">{t("compare.diffEmpty")}</p>;
  }

  const filtered = files.filter((file) => {
    if (filterKind === "script" && file.kind !== "script") return false;
    if (filterKind === "csv" && file.kind !== "csv") return false;
    if (filterKind === "untracked" && file.status !== "U") return false;

    if (searchQuery.trim() !== "") {
      const q = searchQuery.toLowerCase();
      const matchPath = file.path.toLowerCase().includes(q);
      const matchOld = file.oldPath?.toLowerCase().includes(q) ?? false;
      if (!matchPath && !matchOld) return false;
    }
    return true;
  });

  const totalLines = additions + deletions;
  const shown = filtered.slice(0, MAX_DIFF_ROWS);

  return (
    <div className="space-y-4">
      {/* Stats summary & visual ratio bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-meta pb-1 border-b border-border/40">
        <div className="flex flex-wrap items-center gap-3">
          <span className="tabular-nums font-semibold text-positive dark:text-positive">
            +{additions} dòng
          </span>
          <span className="tabular-nums font-semibold text-danger dark:text-danger">
            −{deletions} dòng
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground font-medium">
            {scriptFiles} scripts, {csvFiles} CSVs
          </span>
          {untrackedFiles > 0 && (
            <span className="text-muted-foreground">
              · {t("compare.diffUntracked", { count: untrackedFiles })}
            </span>
          )}
        </div>

        {totalLines > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-micro text-muted-foreground">Tỷ lệ thay đổi</span>
            <div className="flex h-2 w-28 overflow-hidden rounded-full bg-muted">
              <div
                className="bg-positive"
                style={{ width: `${(additions / totalLines) * 100}%` }}
              />
              <div className="bg-danger" style={{ width: `${(deletions / totalLines) * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* Toolbar: Search input & Category Tabs */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo tên file hoặc đường dẫn..."
            className="pl-8 h-8 text-meta"
          />
        </div>

        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setFilterKind("all")}
            className={cn(
              "px-2.5 py-1 rounded-lg text-micro font-medium transition-colors",
              filterKind === "all"
                ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            Tất cả ({files.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterKind("script")}
            className={cn(
              "px-2.5 py-1 rounded-lg text-micro font-medium transition-colors",
              filterKind === "script"
                ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            Scripts ({scriptFiles})
          </button>
          <button
            type="button"
            onClick={() => setFilterKind("csv")}
            className={cn(
              "px-2.5 py-1 rounded-lg text-micro font-medium transition-colors",
              filterKind === "csv"
                ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            CSVs ({csvFiles})
          </button>
          {untrackedFiles > 0 && (
            <button
              type="button"
              onClick={() => setFilterKind("untracked")}
              className={cn(
                "px-2.5 py-1 rounded-lg text-micro font-medium transition-colors",
                filterKind === "untracked"
                  ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              Chưa track ({untrackedFiles})
            </button>
          )}
        </div>
      </div>

      {/* File List */}
      <div className="max-h-80 overflow-y-auto rounded-xl border border-border/70 divide-y divide-border/40 bg-card">
        {shown.length === 0 ? (
          <div className="p-6 text-center text-meta text-muted-foreground">
            Không tìm thấy file nào khớp với bộ lọc.
          </div>
        ) : (
          shown.map((file) => (
            <div
              key={file.path}
              className="flex items-center gap-2.5 px-3.5 py-2 text-meta hover:bg-muted/40 transition-colors"
            >
              <StatusBadge status={file.status} />
              <Badge
                variant="outline"
                className="h-5 shrink-0 px-1.5 text-micro font-semibold uppercase tracking-wider"
              >
                {t(KIND_LABEL_KEYS[file.kind])}
              </Badge>
              <span
                className="truncate font-mono text-meta font-medium select-all"
                title={file.path}
              >
                {file.oldPath !== null ? `${file.oldPath} → ${file.path}` : file.path}
              </span>
              <span className="ml-auto shrink-0 tabular-nums text-meta text-muted-foreground font-mono">
                {file.additions !== null && (
                  <span className="text-positive dark:text-positive font-semibold">
                    +{file.additions}
                  </span>
                )}
                {file.additions !== null && file.deletions !== null && " "}
                {file.deletions !== null && (
                  <span className="text-danger dark:text-danger font-semibold">
                    −{file.deletions}
                  </span>
                )}
              </span>
            </div>
          ))
        )}
      </div>

      {filtered.length > shown.length && (
        <p className="text-meta text-muted-foreground text-center">
          {t("compare.diffMore", { count: filtered.length - shown.length })}
        </p>
      )}
    </div>
  );
}

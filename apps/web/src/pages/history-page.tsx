import type { RunSummary, Verdict } from "@silentskip/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  FolderGit2,
  GitBranch,
  GitCompareArrows,
  History as HistoryIcon,
  Info,
  Loader2,
  Search,
  Sparkles,
  Square,
  SquareCheck,
  Target,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCopilot } from "@/contexts/copilot-context";
import { useProject } from "@/contexts/project-context";
import { formatDateTime, formatDuration } from "@/lib/format";
import { useRuns } from "@/lib/use-runs";

const STATUS_STYLES: Record<RunSummary["status"], string> = {
  queued: "bg-muted text-muted-foreground border-border",
  running: "bg-primary/10 text-primary border-primary/20",
  completed: "bg-positive/10 text-positive border-positive/20",
  failed: "bg-danger/10 text-danger border-danger/20",
  cancelled: "bg-warning/10 text-warning border-warning/20",
};

const STATUS_LABEL_KEYS: Record<RunSummary["status"], string> = {
  queued: "history.statusQueued",
  running: "history.statusRunning",
  completed: "history.statusCompleted",
  failed: "history.statusFailed",
  cancelled: "history.statusCancelled",
};

const VERDICT_STYLES: Record<Verdict, string> = {
  pass: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  pass_with_warnings: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  needs_review: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  fail: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
  insufficient_evidence: "bg-muted text-muted-foreground border-border",
};

const VERDICT_BORDER: Record<Verdict, string> = {
  pass: "border-l-4 border-l-emerald-500",
  pass_with_warnings: "border-l-4 border-l-blue-500",
  needs_review: "border-l-4 border-l-amber-500",
  fail: "border-l-4 border-l-rose-500",
  insufficient_evidence: "border-l-4 border-l-muted-foreground",
};

const VERDICT_LABEL_KEYS: Record<Verdict, string> = {
  pass: "run.verdictPass",
  pass_with_warnings: "run.verdictPassWithWarnings",
  needs_review: "run.verdictNeedsReview",
  fail: "run.verdictFail",
  insufficient_evidence: "run.verdictInsufficient",
};

/**
 * History (E5.3 + E9.4) — modern timeline view of review runs with direct Copilot access,
 * live filter/search, and deterministic run compare.
 */
export function HistoryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projects } = useProject();
  const { openCopilot } = useCopilot();
  const runsQuery = useRuns(null);
  const runs = runsQuery.data?.runs ?? [];
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [verdictFilter, setVerdictFilter] = useState<string>("all");

  function toggleSelected(runId: string): void {
    setSelected((previous) => {
      if (previous.includes(runId)) {
        return previous.filter((id) => id !== runId);
      }
      return [...previous.slice(-1), runId];
    });
  }

  function openCompare(): void {
    const [left, right] = selected;
    if (left === undefined || right === undefined) {
      return;
    }
    void navigate({ to: "/history/compare", search: { left, right } });
  }

  const filteredRuns = useMemo(() => {
    let list = runs;
    if (verdictFilter !== "all") {
      list = list.filter((r) => r.verdict === verdictFilter);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q === "") return list;
    return list.filter((run) => {
      const projName = (
        projects.find((p) => p.id === run.projectId)?.name ?? run.projectId
      ).toLowerCase();
      return (
        projName.includes(q) ||
        run.baseRef.toLowerCase().includes(q) ||
        run.currentRef.toLowerCase().includes(q) ||
        Boolean(run.goal?.toLowerCase().includes(q))
      );
    });
  }, [runs, verdictFilter, searchQuery, projects]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("history.title")}
        description={t("history.description")}
        badge={
          runs.length > 0 ? (
            <Badge variant="outline" className="text-micro font-medium">
              {runs.length} lượt chạy
            </Badge>
          ) : undefined
        }
      />

      {/* Floating compare action bar when runs are selected */}
      {selected.length > 0 && (
        <Card className="surface border-primary/40 bg-primary/5 shadow-md">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3.5">
            <div className="space-y-0.5">
              <p className="text-body font-semibold text-foreground">
                {t("historyCompare.selection", { count: selected.length })}
              </p>
              <p className="text-meta text-muted-foreground">{t("historyCompare.selectionHint")}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                {t("historyCompare.clear")}
              </Button>
              <Button size="sm" disabled={selected.length !== 2} onClick={openCompare}>
                <GitCompareArrows className="size-4" />
                {t("historyCompare.compareCta")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter and Search Bar */}
      {runs.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo branch, commit, mục tiêu..."
              className="pl-9 text-body"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant={verdictFilter === "all" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setVerdictFilter("all")}
              className="h-8 text-meta"
            >
              Tất cả ({runs.length})
            </Button>
            <Button
              type="button"
              variant={verdictFilter === "pass" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setVerdictFilter("pass")}
              className="h-8 text-meta"
            >
              Đạt
            </Button>
            <Button
              type="button"
              variant={verdictFilter === "needs_review" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setVerdictFilter("needs_review")}
              className="h-8 text-meta"
            >
              Cần review
            </Button>
            <Button
              type="button"
              variant={verdictFilter === "fail" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setVerdictFilter("fail")}
              className="h-8 text-meta"
            >
              Không đạt
            </Button>
          </div>
        </div>
      )}

      {runsQuery.isError ? (
        <Card className="surface">
          <CardContent>
            <EmptyState
              icon={TriangleAlert}
              title={t("errors.loadTitle")}
              description={t("errors.loadDescription")}
              action={
                <Button variant="outline" onClick={() => void runsQuery.refetch()}>
                  {t("common.retry")}
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : runsQuery.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ) : runs.length === 0 ? (
        <Card className="surface">
          <CardContent>
            <EmptyState
              icon={HistoryIcon}
              title={t("history.emptyTitle")}
              description={t("history.emptyDescription")}
              action={
                <Button asChild variant="outline">
                  <Link to="/compare">{t("history.emptyCta")}</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : filteredRuns.length === 0 ? (
        <Card className="surface">
          <CardContent className="py-8 text-center text-muted-foreground">
            <p className="text-body">Không tìm thấy lượt chạy phù hợp với bộ lọc.</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 text-primary"
              onClick={() => {
                setSearchQuery("");
                setVerdictFilter("all");
              }}
            >
              Xóa bộ lọc
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredRuns.map((run) => {
            const projectName =
              projects.find((project) => project.id === run.projectId)?.name ?? run.projectId;
            const isSelected = selected.includes(run.id);

            const borderAccent =
              run.verdict !== null
                ? VERDICT_BORDER[run.verdict]
                : run.status === "running"
                  ? "border-l-4 border-l-primary"
                  : run.status === "failed"
                    ? "border-l-4 border-l-rose-500"
                    : "border-l-4 border-l-border";

            return (
              <Card
                key={run.id}
                className={cn(
                  "surface surface-interactive overflow-hidden transition-all",
                  borderAccent,
                  isSelected && "border-primary/50 bg-primary/5 ring-1 ring-primary/30",
                )}
              >
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span
                        className={cn(
                          "inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-micro font-medium shadow-2xs",
                          STATUS_STYLES[run.status],
                        )}
                      >
                        {run.status === "running" ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : run.status === "failed" ? (
                          <TriangleAlert className="size-3" />
                        ) : run.status === "completed" ? (
                          <CheckCircle2 className="size-3" />
                        ) : (
                          <Info className="size-3" />
                        )}
                        {t(STATUS_LABEL_KEYS[run.status])}
                      </span>

                      {run.verdict !== null && (
                        <span
                          className={cn(
                            "inline-flex h-6 items-center rounded-md border px-2 text-micro font-bold shadow-2xs",
                            VERDICT_STYLES[run.verdict],
                          )}
                        >
                          {t(VERDICT_LABEL_KEYS[run.verdict])}
                        </span>
                      )}

                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        <FolderGit2 className="size-3.5 text-primary" />
                        <span className="truncate text-body">{projectName}</span>
                      </div>

                      <div className="flex items-center gap-1 text-meta text-muted-foreground tabular-nums">
                        <Clock className="size-3" />
                        <span>{formatDateTime(run.createdAt)}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 font-mono text-body text-foreground/90">
                      <GitBranch className="size-4 text-muted-foreground" />
                      <span className="font-semibold text-foreground">{run.baseRef}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="font-semibold text-primary">{run.currentRef}</span>

                      {run.durationMs !== null && (
                        <span className="ml-2 font-sans text-meta text-muted-foreground tabular-nums">
                          ({formatDuration(run.durationMs)})
                        </span>
                      )}

                      {run.qualityScore !== null && (
                        <span className="rounded-md border border-border/70 bg-muted/30 px-2 py-0.5 font-sans text-micro font-bold tabular-nums text-foreground">
                          {run.qualityScore}/100 điểm
                        </span>
                      )}
                    </div>

                    {run.goal !== null && run.goal.trim() !== "" && (
                      <div className="flex items-center gap-1.5 text-meta text-muted-foreground">
                        <Target className="size-3.5 text-primary" />
                        <span className="truncate">{run.goal}</span>
                      </div>
                    )}

                    {run.error !== null && (
                      <p className="truncate text-meta text-danger">{run.error}</p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2 pt-2 sm:pt-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 text-primary hover:bg-primary/10 hover:text-primary"
                      onClick={() =>
                        openCopilot({
                          projectId: run.projectId,
                          baseRef: run.baseRef,
                          currentRef: run.currentRef,
                          runId: run.id,
                        })
                      }
                      title="Hỏi Copilot về lượt chạy này"
                    >
                      <Sparkles className="size-3.5" />
                      <span className="text-meta font-medium">Hỏi Copilot</span>
                    </Button>

                    <Button
                      type="button"
                      variant={isSelected ? "secondary" : "outline"}
                      size="sm"
                      className="gap-1.5 text-meta"
                      onClick={() => toggleSelected(run.id)}
                    >
                      {isSelected ? (
                        <SquareCheck className="size-4 text-primary" />
                      ) : (
                        <Square className="size-4 text-muted-foreground" />
                      )}
                      <span>{isSelected ? "Đã chọn" : "So sánh"}</span>
                    </Button>

                    <Button asChild variant="default" size="sm" className="gap-1 text-meta">
                      <Link to="/runs/$runId" params={{ runId: run.id }}>
                        <span>Báo cáo</span>
                        <ChevronRight className="size-3.5" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

import type { RunSummary, Verdict } from "@silentskip/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import {
  ChevronRight,
  GitCompareArrows,
  History as HistoryIcon,
  Square,
  SquareCheck,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useProject } from "@/contexts/project-context";
import { formatDateTime, formatDuration } from "@/lib/format";
import { useRuns } from "@/lib/use-runs";

const STATUS_STYLES: Record<RunSummary["status"], string> = {
  queued: "bg-neutral/15 text-neutral",
  running: "bg-info/15 text-info",
  completed: "bg-positive/15 text-positive",
  failed: "bg-danger/15 text-danger",
  cancelled: "bg-warning/15 text-warning",
};

const STATUS_LABEL_KEYS: Record<RunSummary["status"], string> = {
  queued: "history.statusQueued",
  running: "history.statusRunning",
  completed: "history.statusCompleted",
  failed: "history.statusFailed",
  cancelled: "history.statusCancelled",
};

const VERDICT_STYLES: Record<Verdict, string> = {
  pass: "bg-positive/15 text-positive",
  pass_with_warnings: "bg-info/15 text-info",
  needs_review: "bg-warning/15 text-warning",
  fail: "bg-danger/15 text-danger",
  insufficient_evidence: "bg-neutral/15 text-neutral",
};

const VERDICT_LABEL_KEYS: Record<Verdict, string> = {
  pass: "run.verdictPass",
  pass_with_warnings: "run.verdictPassWithWarnings",
  needs_review: "run.verdictNeedsReview",
  fail: "run.verdictFail",
  insufficient_evidence: "run.verdictInsufficient",
};

/**
 * History (E5.3 + E9.4) — every review run, newest first, straight from the local database.
 * One wide card per run that opens the report; the selection boxes on the side pick exactly
 * two runs for the deterministic compare view.
 */
export function HistoryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projects } = useProject();
  const runsQuery = useRuns(null);
  const runs = runsQuery.data?.runs ?? [];
  const [selected, setSelected] = useState<readonly string[]>([]);

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

  return (
    <div className="space-y-6">
      <PageHeader title={t("history.title")} description={t("history.description")} />

      {selected.length > 0 && (
        <Card className="border-foreground/20">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="space-y-0.5">
              <p className="text-body font-medium">
                {t("historyCompare.selection", { count: selected.length })}
              </p>
              <p className="text-meta text-muted-foreground">{t("historyCompare.selectionHint")}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                {t("historyCompare.clear")}
              </Button>
              <Button size="sm" disabled={selected.length !== 2} onClick={openCompare}>
                <GitCompareArrows className="size-3.5" />
                {t("historyCompare.compareCta")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {runsQuery.isError ? (
        <Card>
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
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : runs.length === 0 ? (
        <Card>
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
      ) : (
        <div className="space-y-3">
          {runs.map((run) => {
            const projectName =
              projects.find((project) => project.id === run.projectId)?.name ?? run.projectId;
            const isSelected = selected.includes(run.id);
            return (
              <Card
                key={run.id}
                className={cn(
                  "relative py-4 transition-colors hover:border-foreground/25 hover:bg-muted/20",
                  isSelected && "border-foreground/40 bg-muted/20",
                )}
              >
                <button
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={t("historyCompare.select")}
                  title={t("historyCompare.select")}
                  onClick={() => toggleSelected(run.id)}
                  className="absolute top-3 right-3 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {isSelected ? (
                    <SquareCheck aria-hidden="true" className="size-4 text-primary" />
                  ) : (
                    <Square aria-hidden="true" className="size-4" />
                  )}
                </button>
                <Link to="/runs/$runId" params={{ runId: run.id }} className="group block">
                  <CardContent className="flex flex-col gap-2 px-5 pr-12 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex h-6 items-center rounded-md px-2 text-micro font-medium",
                            STATUS_STYLES[run.status],
                          )}
                        >
                          {t(STATUS_LABEL_KEYS[run.status])}
                        </span>
                        <span className="truncate text-body font-medium">{projectName}</span>
                        <span className="text-meta text-muted-foreground tabular-nums">
                          {formatDateTime(run.createdAt)}
                        </span>
                      </div>
                      <div
                        className="truncate font-mono text-meta"
                        title={`${run.baseRef} → ${run.currentRef}`}
                      >
                        {run.baseRef} → {run.currentRef}
                      </div>
                      {run.goal !== null && run.goal.trim() !== "" && (
                        <p className="truncate text-meta text-muted-foreground">
                          {t("history.goal", { goal: run.goal })}
                        </p>
                      )}
                      {run.error !== null && (
                        <p className="truncate text-meta text-danger">{run.error}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2.5">
                      {run.verdict !== null && (
                        <>
                          <span
                            className={cn(
                              "inline-flex h-6 items-center rounded-md px-2 text-micro font-medium",
                              VERDICT_STYLES[run.verdict],
                            )}
                          >
                            {t(VERDICT_LABEL_KEYS[run.verdict])}
                          </span>
                          {run.qualityScore !== null && (
                            <span className="text-meta text-muted-foreground tabular-nums">
                              {run.qualityScore}/100
                            </span>
                          )}
                        </>
                      )}
                      {run.durationMs !== null && (
                        <span className="text-meta text-muted-foreground tabular-nums">
                          {formatDuration(run.durationMs)}
                        </span>
                      )}
                      <ChevronRight
                        aria-hidden="true"
                        className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                      />
                    </div>
                  </CardContent>
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

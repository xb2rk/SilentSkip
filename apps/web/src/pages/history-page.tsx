import type { RunSummary, Verdict } from "@craftland-qa/contracts";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { History as HistoryIcon, TriangleAlert } from "lucide-react";
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
  queued: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400",
  running: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  failed: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  cancelled: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};

const STATUS_LABEL_KEYS: Record<RunSummary["status"], string> = {
  queued: "history.statusQueued",
  running: "history.statusRunning",
  completed: "history.statusCompleted",
  failed: "history.statusFailed",
  cancelled: "history.statusCancelled",
};

const VERDICT_STYLES: Record<Verdict, string> = {
  pass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  pass_with_warnings: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  needs_review: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  fail: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  insufficient_evidence: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400",
};

const VERDICT_LABEL_KEYS: Record<Verdict, string> = {
  pass: "run.verdictPass",
  pass_with_warnings: "run.verdictPassWithWarnings",
  needs_review: "run.verdictNeedsReview",
  fail: "run.verdictFail",
  insufficient_evidence: "run.verdictInsufficient",
};

/**
 * History (E5.3) — every review run, newest first, straight from the local database.
 * One wide card per run: project, range, time, status, verdict and duration at a glance,
 * opening the run report from the card.
 */
export function HistoryPage() {
  const { t } = useTranslation();
  const { projects } = useProject();
  const runsQuery = useRuns(null);
  const runs = runsQuery.data?.runs ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title={t("history.title")} description={t("history.description")} />

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
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
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
          {runs.map((run) => (
            <Card key={run.id}>
              <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex h-6 items-center rounded-md px-2 text-[11px] font-medium",
                        STATUS_STYLES[run.status],
                      )}
                    >
                      {t(STATUS_LABEL_KEYS[run.status])}
                    </span>
                    <span className="truncate text-[13px] font-medium">
                      {projects.find((project) => project.id === run.projectId)?.name ??
                        run.projectId}
                    </span>
                    <span className="text-[11.5px] text-muted-foreground tabular-nums">
                      {formatDateTime(run.createdAt)}
                    </span>
                  </div>
                  <div
                    className="truncate font-mono text-[12px]"
                    title={`${run.baseRef} → ${run.currentRef}`}
                  >
                    {run.baseRef} → {run.currentRef}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {run.verdict !== null && (
                      <>
                        <span
                          className={cn(
                            "inline-flex h-6 items-center rounded-md px-2 text-[11px] font-medium",
                            VERDICT_STYLES[run.verdict],
                          )}
                        >
                          {t(VERDICT_LABEL_KEYS[run.verdict])}
                        </span>
                        {run.qualityScore !== null && (
                          <span className="text-[11.5px] text-muted-foreground tabular-nums">
                            {run.qualityScore}/100
                          </span>
                        )}
                      </>
                    )}
                    {run.durationMs !== null && (
                      <span className="text-[11.5px] text-muted-foreground tabular-nums">
                        {formatDuration(run.durationMs)}
                      </span>
                    )}
                  </div>
                </div>
                <Button asChild variant="outline" size="sm" className="self-start sm:self-center">
                  <Link to="/runs/$runId" params={{ runId: run.id }}>
                    {t("history.open")}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

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
  queued: "bg-neutral/15 text-neutral dark:text-neutral",
  running: "bg-info/15 text-info dark:text-info",
  completed: "bg-positive/15 text-positive dark:text-positive",
  failed: "bg-danger/15 text-danger dark:text-danger",
  cancelled: "bg-warning/15 text-warning dark:text-warning",
};

const STATUS_LABEL_KEYS: Record<RunSummary["status"], string> = {
  queued: "history.statusQueued",
  running: "history.statusRunning",
  completed: "history.statusCompleted",
  failed: "history.statusFailed",
  cancelled: "history.statusCancelled",
};

const VERDICT_STYLES: Record<Verdict, string> = {
  pass: "bg-positive/15 text-positive dark:text-positive",
  pass_with_warnings: "bg-info/15 text-info dark:text-info",
  needs_review: "bg-warning/15 text-warning dark:text-warning",
  fail: "bg-danger/15 text-danger dark:text-danger",
  insufficient_evidence: "bg-neutral/15 text-neutral dark:text-neutral",
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
                        "inline-flex h-6 items-center rounded-md px-2 text-micro font-medium",
                        STATUS_STYLES[run.status],
                      )}
                    >
                      {t(STATUS_LABEL_KEYS[run.status])}
                    </span>
                    <span className="truncate text-body font-medium">
                      {projects.find((project) => project.id === run.projectId)?.name ??
                        run.projectId}
                    </span>
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
                  <div className="flex flex-wrap items-center gap-2">
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

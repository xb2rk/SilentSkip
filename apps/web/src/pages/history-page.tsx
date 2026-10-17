import type { RunSummary, Verdict } from "@craftland-qa/contracts";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { History as HistoryIcon, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
 * Rows are self-contained summaries; opening one lands on the run report page.
 */
export function HistoryPage() {
  const { t } = useTranslation();
  const { projects } = useProject();
  const runsQuery = useRuns(null);
  const runs = runsQuery.data?.runs ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title={t("history.title")} description={t("history.description")} />

      <Alert>
        <Info className="size-4" />
        <AlertDescription>{t("history.banner")}</AlertDescription>
      </Alert>

      {runsQuery.isPending ? (
        <Card>
          <CardContent className="space-y-2 py-6">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </CardContent>
        </Card>
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
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("history.colStarted")}</TableHead>
                  <TableHead>{t("history.colProject")}</TableHead>
                  <TableHead>{t("history.colRefs")}</TableHead>
                  <TableHead>{t("history.colStatus")}</TableHead>
                  <TableHead>{t("history.colVerdict")}</TableHead>
                  <TableHead>{t("history.colDuration")}</TableHead>
                  <TableHead className="text-right">{t("history.open")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="whitespace-nowrap text-[12px] tabular-nums">
                      {formatDateTime(run.createdAt)}
                    </TableCell>
                    <TableCell className="max-w-44 truncate text-[12.5px]" title={run.projectId}>
                      {projects.find((project) => project.id === run.projectId)?.name ??
                        run.projectId}
                    </TableCell>
                    <TableCell
                      className="max-w-56 truncate font-mono text-[11.5px]"
                      title={`${run.baseRef} → ${run.currentRef}`}
                    >
                      {run.baseRef} → {run.currentRef}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex h-5 items-center rounded-md px-1.5 text-[10.5px] font-medium",
                          STATUS_STYLES[run.status],
                        )}
                      >
                        {t(STATUS_LABEL_KEYS[run.status])}
                      </span>
                    </TableCell>
                    <TableCell>
                      {run.verdict === null ? (
                        <span className="text-[12px] text-muted-foreground">—</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className={cn(
                              "inline-flex h-5 items-center rounded-md px-1.5 text-[10.5px] font-medium",
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
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-[12px] text-muted-foreground tabular-nums">
                      {run.durationMs === null ? "—" : formatDuration(run.durationMs)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link to="/runs/$runId" params={{ runId: run.id }}>
                          {t("history.open")}
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

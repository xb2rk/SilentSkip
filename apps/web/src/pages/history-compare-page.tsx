import type {
  ReviewCompareFinding,
  ReviewCompareSide,
  ReviewCompareSurface,
  RunSummary,
  SurfaceHistoryEntry,
  Verdict,
} from "@craftland-qa/contracts";
import { Link, useSearch } from "@tanstack/react-router";
import { ArrowLeft, GitCompareArrows, TriangleAlert } from "lucide-react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatDuration } from "@/lib/format";
import { useRunCompare, useSurfaceHistory } from "@/lib/use-runs";

const STATUS_LABEL_KEYS: Record<RunSummary["status"], string> = {
  queued: "history.statusQueued",
  running: "history.statusRunning",
  completed: "history.statusCompleted",
  failed: "history.statusFailed",
  cancelled: "history.statusCancelled",
};

const VERDICT_LABEL_KEYS: Record<Verdict, string> = {
  pass: "run.verdictPass",
  pass_with_warnings: "run.verdictPassWithWarnings",
  needs_review: "run.verdictNeedsReview",
  fail: "run.verdictFail",
  insufficient_evidence: "run.verdictInsufficient",
};

function SideCard({
  side,
  label,
}: {
  readonly side: ReviewCompareSide;
  readonly label: string;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Card className="py-4">
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-meta font-medium text-muted-foreground">{label}</span>
          <Badge variant="outline" className="font-mono text-micro">
            {side.runId.slice(0, 8)}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="text-micro">
            {t(STATUS_LABEL_KEYS[side.status])}
          </Badge>
          {side.verdict !== null && (
            <Badge variant="outline" className="text-micro">
              {t(VERDICT_LABEL_KEYS[side.verdict])}
              {side.qualityScore !== null ? ` · ${side.qualityScore}/100` : ""}
            </Badge>
          )}
        </div>
        <p className="text-meta text-muted-foreground tabular-nums">
          {formatDateTime(side.createdAt)}
          {side.durationMs !== null ? ` · ${formatDuration(side.durationMs)}` : ""}
        </p>
        <dl className="grid grid-cols-3 gap-2 pt-1">
          <div>
            <dt className="text-micro text-muted-foreground">
              {t("historyCompare.metricFindings")}
            </dt>
            <dd className="text-body tabular-nums">{side.findingsCount}</dd>
          </div>
          <div>
            <dt className="text-micro text-muted-foreground">{t("historyCompare.metricThemes")}</dt>
            <dd className="text-body tabular-nums">{side.themesCount}</dd>
          </div>
          <div>
            <dt className="text-micro text-muted-foreground">
              {t("historyCompare.metricUnknowns")}
            </dt>
            <dd className="text-body tabular-nums">{side.unknownsCount}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

function FindingRow({ finding }: { readonly finding: ReviewCompareFinding }): ReactElement {
  const { t } = useTranslation();
  return (
    <li className="flex flex-col gap-1 border-t border-border/60 py-2 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono text-micro">
          {finding.ruleId}
        </Badge>
        <span className="text-meta text-muted-foreground">{finding.severity}</span>
        <span className="text-micro text-muted-foreground">
          {finding.inLeft && !finding.inRight
            ? t("historyCompare.onlyLeft")
            : !finding.inLeft && finding.inRight
              ? t("historyCompare.onlyRight")
              : t("historyCompare.both")}
        </span>
      </div>
      <p className="text-body">{finding.title}</p>
      <p className="font-mono text-micro text-muted-foreground">{finding.id}</p>
    </li>
  );
}

function SurfaceRow({ surface }: { readonly surface: ReviewCompareSurface }): ReactElement {
  const { t } = useTranslation();
  return (
    <li className="flex flex-col gap-1 border-t border-border/60 py-2 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-micro">
          {surface.mechanism}
        </Badge>
        <span className="text-meta text-muted-foreground">{surface.effect}</span>
        <span className="text-micro text-muted-foreground">
          {surface.inLeft && !surface.inRight
            ? t("historyCompare.onlyLeft")
            : !surface.inLeft && surface.inRight
              ? t("historyCompare.onlyRight")
              : t("historyCompare.both")}
        </span>
      </div>
      <p className="font-mono text-micro">
        {surface.table}
        {surface.rowKey !== "" ? ` · ${surface.rowKey}` : ""}
        {surface.column !== null ? ` · ${surface.column}` : ""}
      </p>
    </li>
  );
}

function SurfaceChart({
  entries,
}: {
  readonly entries: readonly SurfaceHistoryEntry[];
}): ReactElement {
  const { t } = useTranslation();
  const max = Math.max(1, ...entries.map((entry) => Math.max(entry.newSilent, entry.fixed)));
  return (
    <div className="space-y-2">
      {[...entries].reverse().map((entry) => (
        <div key={entry.runId} className="flex items-center gap-3">
          <span className="w-32 shrink-0 truncate text-micro text-muted-foreground tabular-nums">
            {formatDateTime(entry.createdAt)}
          </span>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <div
                className="h-2 rounded-sm bg-warning/70"
                style={{ width: `${(entry.newSilent / max) * 100}%` }}
              />
              <span className="text-micro text-muted-foreground tabular-nums">
                {t("historyCompare.chartNew")} {entry.newSilent}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="h-2 rounded-sm bg-positive/70"
                style={{ width: `${(entry.fixed / max) * 100}%` }}
              />
              <span className="text-micro text-muted-foreground tabular-nums">
                {t("historyCompare.chartFixed")} {entry.fixed}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * History compare (E9.4) — pick two stored runs in History and read the deterministic diff:
 * side metrics, engine finding id diff and silent-skip entry diff. AI prose is counted only;
 * legacy runs without engine data are flagged instead of being shown as empty.
 */
export function HistoryComparePage(): ReactElement {
  const { t } = useTranslation();
  const search = useSearch({ from: "/history/compare" });
  const leftId = search.left ?? null;
  const rightId = search.right ?? null;
  const compareQuery = useRunCompare(leftId, rightId);
  const projectId = compareQuery.data?.left.projectId ?? null;
  const historyQuery = useSurfaceHistory(projectId);
  const compare = compareQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("historyCompare.title")}
        description={t("historyCompare.description")}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/history">
              <ArrowLeft className="size-3.5" />
              {t("historyCompare.back")}
            </Link>
          </Button>
        }
      />

      {leftId === null || rightId === null ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={GitCompareArrows}
              title={t("historyCompare.missingTitle")}
              description={t("historyCompare.missingDescription")}
              action={
                <Button asChild variant="outline">
                  <Link to="/history">{t("historyCompare.back")}</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : compareQuery.isError ? (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertTitle>{t("errors.loadTitle")}</AlertTitle>
          <AlertDescription className="flex items-center gap-3">
            <span>{t("errors.loadDescription")}</span>
            <Button variant="outline" size="sm" onClick={() => void compareQuery.refetch()}>
              {t("common.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : compareQuery.isPending || compare === undefined ? (
        <div className="space-y-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <SideCard side={compare.left} label={t("historyCompare.left")} />
            <SideCard side={compare.right} label={t("historyCompare.right")} />
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-body">{t("historyCompare.engineTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-meta text-muted-foreground">{t("historyCompare.engineHint")}</p>
              {compare.engineFindings.length === 0 ? (
                <p className="text-meta text-muted-foreground">{t("historyCompare.engineEmpty")}</p>
              ) : (
                <ul className="space-y-1">
                  {compare.engineFindings.map((finding) => (
                    <FindingRow key={finding.id} finding={finding} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-body">{t("historyCompare.surfacesTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-meta text-muted-foreground">{t("historyCompare.surfacesHint")}</p>
              {compare.surfaces.length === 0 ? (
                <p className="text-meta text-muted-foreground">
                  {t("historyCompare.surfacesEmpty")}
                </p>
              ) : (
                <ul className="space-y-1">
                  {compare.surfaces.map((surface) => (
                    <SurfaceRow key={surface.id} surface={surface} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-body">{t("historyCompare.chartTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-meta text-muted-foreground">{t("historyCompare.chartHint")}</p>
              {historyQuery.isPending ? (
                <Skeleton className="h-24" />
              ) : historyQuery.data === undefined || historyQuery.data.entries.length === 0 ? (
                <p className="text-meta text-muted-foreground">{t("historyCompare.chartEmpty")}</p>
              ) : (
                <SurfaceChart entries={historyQuery.data.entries} />
              )}
            </CardContent>
          </Card>

          <p className="text-meta text-muted-foreground">{compare.note}</p>
        </>
      )}
    </div>
  );
}

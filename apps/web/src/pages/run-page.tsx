import type { Anchor, ReviewRunResult, ReviewStreamEvent, Verdict } from "@craftland-qa/contracts";
import { Link, useParams } from "@tanstack/react-router";
import { cn } from "cn";
import { Ban, CheckCircle2, GitCompareArrows, Info, Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ChangeFacts } from "@/components/report/change-facts";
import { EvidenceDialog } from "@/components/report/evidence-dialog";
import { FindingCard } from "@/components/report/finding-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProject } from "@/contexts/project-context";
import { formatDateTime, formatDuration } from "@/lib/format";
import { useDigest } from "@/lib/use-projects";
import { useRunStream } from "@/lib/use-run-stream";
import { useCancelReview, useRun } from "@/lib/use-runs";

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

const STAGE_ORDER = ["digest", "digest_read", "dig", "synthesize"] as const;
type StageName = (typeof STAGE_ORDER)[number];

const STAGE_LABEL_KEYS: Record<StageName, string> = {
  digest: "run.stageDigest",
  digest_read: "run.stageDigestRead",
  dig: "run.stageDig",
  synthesize: "run.stageSynthesize",
};

interface StageState {
  readonly state: "pending" | "active" | "done";
  readonly latencyMs?: number;
}

/** Fold the streamed stage events into one state per pipeline stage. */
function stageStates(events: readonly ReviewStreamEvent[]): Record<StageName, StageState> {
  const states: Record<StageName, StageState> = {
    digest: { state: "pending" },
    digest_read: { state: "pending" },
    dig: { state: "pending" },
    synthesize: { state: "pending" },
  };
  for (const event of events) {
    if (event.type !== "stage") continue;
    states[event.stage] =
      event.state === "started"
        ? { state: "active" }
        : {
            state: "done",
            ...(event.latencyMs === undefined ? {} : { latencyMs: event.latencyMs }),
          };
  }
  return states;
}

interface VerificationSummary {
  readonly anchorsChecked: number;
  readonly anchorsStripped: number;
  readonly percent: number | null;
  readonly issues: number;
}

function summarizeVerification(result: ReviewRunResult): VerificationSummary {
  const passes = [
    result.verification.read,
    ...(result.verification.dig === null ? [] : [result.verification.dig]),
    result.verification.synthesize,
  ];
  const anchorsChecked = passes.reduce((sum, stats) => sum + stats.anchorsChecked, 0);
  const anchorsStripped = passes.reduce((sum, stats) => sum + stats.anchorsStripped, 0);
  return {
    anchorsChecked,
    anchorsStripped,
    percent: anchorsChecked === 0 ? null : Math.round(100 * (1 - anchorsStripped / anchorsChecked)),
    issues: result.verification.issues.length,
  };
}

/**
 * Run report (E5) — live progress while the run executes, then the three-layer report:
 * "Đã thay đổi" (engine facts), "Thiếu-đứt" (verified findings), "Ghi chú" (AI prose, clearly
 * labelled). Every citation opens the exact anchored span in the evidence dialog.
 */
export function RunPage() {
  const { runId } = useParams({ from: "/runs/$runId" });
  const { t } = useTranslation();
  const { projects } = useProject();
  const runQuery = useRun(runId);
  const { events } = useRunStream(runId);
  const cancelRun = useCancelReview();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [notified, setNotified] = useState(false);

  const run = runQuery.data;
  const projectName =
    run === undefined
      ? null
      : (projects.find((project) => project.id === run.projectId)?.name ?? null);

  useEffect(() => {
    if (notified) return;
    const terminal = [...events].reverse().find((event) => event.type !== "stage");
    if (terminal === undefined) return;
    setNotified(true);
    if (terminal.type === "completed") toast.success(t("run.completedToast"));
    else if (terminal.type === "failed") toast.error(t("run.failedToast"));
    else toast(t("run.cancelledToast"));
  }, [events, notified, t]);

  const digestQuery = useDigest(
    run !== undefined && run.status === "completed" ? run.projectId : null,
    run?.baseRef ?? null,
    run?.currentRef ?? null,
  );
  const anchorsById = useMemo(
    () => new Map((digestQuery.data?.anchors ?? []).map((item) => [item.id, item])),
    [digestQuery.data],
  );

  if (runQuery.isPending) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("run.title")} description={t("run.description")} />
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (runQuery.isError || run === undefined) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("run.title")} description={t("run.description")} />
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertTitle>{t("run.notFoundTitle")}</AlertTitle>
          <AlertDescription>
            {runQuery.error instanceof Error
              ? runQuery.error.message
              : t("run.notFoundDescription")}
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline" size="sm">
          <Link to="/history">{t("nav.history")}</Link>
        </Button>
      </div>
    );
  }

  const result = run.result;
  const running = run.status === "queued" || run.status === "running";
  const states = stageStates(events);
  const verification = result === null ? null : summarizeVerification(result);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("run.title")}
        description={t("run.description")}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/compare">
              <GitCompareArrows className="size-4" />
              {t("run.backToCompare")}
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px]">
          <span className="font-medium">{projectName ?? run.projectId}</span>
          <span className="font-mono text-[11.5px]" title={`${run.baseRef} → ${run.currentRef}`}>
            {run.baseRef} → {run.currentRef}
          </span>
          <span className="text-muted-foreground">
            {t("run.startedAt")} {formatDateTime(run.createdAt)}
          </span>
          {run.durationMs !== null && (
            <span className="text-muted-foreground">{formatDuration(run.durationMs)}</span>
          )}
          {run.goal !== null && run.goal !== "" && (
            <span className="text-muted-foreground">
              {t("run.goalLabel")}: {run.goal}
            </span>
          )}
        </CardContent>
      </Card>

      {running && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Loader2 className="size-4 animate-spin text-primary" />
              {run.status === "queued" ? t("run.statusQueued") : t("run.statusRunning")}
            </CardTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={cancelRun.isPending}
              onClick={() => {
                cancelRun.mutate(runId, {
                  onSuccess: () => toast(t("run.cancelledToast")),
                  onError: () => toast.error(t("run.failedToast")),
                });
              }}
            >
              <Ban className="size-3.5" />
              {cancelRun.isPending ? t("run.cancelling") : t("run.cancelRun")}
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {STAGE_ORDER.map((stage) => {
              const state = states[stage];
              return (
                <div key={stage} className="flex items-center gap-2 text-[12.5px]">
                  {state.state === "done" ? (
                    <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                  ) : state.state === "active" ? (
                    <Loader2 className="size-4 animate-spin text-primary" />
                  ) : (
                    <span className="size-4 rounded-full border border-border" />
                  )}
                  <span className={cn(state.state === "pending" && "text-muted-foreground")}>
                    {t(STAGE_LABEL_KEYS[stage])}
                  </span>
                  {state.latencyMs !== undefined && (
                    <span className="text-[11.5px] text-muted-foreground tabular-nums">
                      {t("run.passLatency", { ms: state.latencyMs })}
                    </span>
                  )}
                </div>
              );
            })}
            <p className="pt-1 text-[11.5px] text-muted-foreground">{t("run.progressNote")}</p>
          </CardContent>
        </Card>
      )}

      {run.status === "failed" && (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertTitle>{t("run.statusFailed")}</AlertTitle>
          <AlertDescription>{run.error ?? t("run.notFoundDescription")}</AlertDescription>
        </Alert>
      )}

      {run.status === "cancelled" && (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>{t("run.statusCancelled")}</AlertTitle>
          <AlertDescription>{run.error ?? t("run.cancelledToast")}</AlertDescription>
        </Alert>
      )}

      {run.status === "completed" && result !== null && verification !== null && (
        <>
          {result.fallbackReason !== null && (
            <Alert>
              <Info className="size-4" />
              <AlertTitle>{t("run.fallbackTitle")}</AlertTitle>
              <AlertDescription>{result.fallbackReason}</AlertDescription>
            </Alert>
          )}

          <Card>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <span
                  className={cn(
                    "inline-flex h-7 items-center rounded-lg px-2.5 text-[12.5px] font-semibold",
                    VERDICT_STYLES[result.report.verdict],
                  )}
                >
                  {t(VERDICT_LABEL_KEYS[result.report.verdict])}
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xl font-semibold tabular-nums">
                    {result.report.qualityScore}
                  </span>
                  <span className="text-[11.5px] text-muted-foreground">/100</span>
                </div>
                <span className="text-[12px] text-muted-foreground">{t("run.scoreHint")}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[12px]">
                <span className="font-medium">
                  {verification.percent === null
                    ? t("run.verifiedNone")
                    : t("run.verifiedAnchors", { percent: verification.percent })}
                </span>
                {verification.percent !== null && (
                  <span className="text-muted-foreground">
                    {t("run.verifiedDetail", {
                      checked: verification.anchorsChecked,
                      stripped: verification.anchorsStripped,
                      issues: verification.issues,
                    })}
                  </span>
                )}
              </div>
              {result.passes.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11.5px] text-muted-foreground">
                    {t("run.passesLabel")}:
                  </span>
                  {result.passes.map((meta) => (
                    <Badge key={meta.pass} variant="secondary" className="font-normal">
                      {meta.pass} · {t("run.passLatency", { ms: meta.latencyMs })} · {meta.salvage}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Tabs defaultValue="changes">
            <TabsList>
              <TabsTrigger value="changes">{t("run.tabChanges")}</TabsTrigger>
              <TabsTrigger value="findings">
                {t("run.tabFindings")} ({result.report.findings.length})
              </TabsTrigger>
              <TabsTrigger value="notes">{t("run.tabNotes")}</TabsTrigger>
            </TabsList>

            <TabsContent value="changes" className="pt-2">
              {run.currentRef === "WORKTREE" && (
                <p className="mb-3 text-[11.5px] text-muted-foreground">
                  {t("run.changesWorktreeNote")}
                </p>
              )}
              {digestQuery.isPending ? (
                <div className="space-y-2">
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                </div>
              ) : digestQuery.isError || digestQuery.data === undefined ? (
                <Alert variant="destructive">
                  <TriangleAlert className="size-4" />
                  <AlertDescription>
                    {digestQuery.error instanceof Error
                      ? digestQuery.error.message
                      : t("run.changesEmpty")}
                  </AlertDescription>
                </Alert>
              ) : (
                <ChangeFacts
                  digest={digestQuery.data}
                  anchorsById={anchorsById}
                  onAnchorClick={setAnchor}
                />
              )}
            </TabsContent>

            <TabsContent value="findings" className="space-y-3 pt-2">
              {result.report.findings.length === 0 ? (
                <p className="text-[12.5px] text-muted-foreground">{t("run.findingsEmpty")}</p>
              ) : (
                result.report.findings.map((finding) => (
                  <FindingCard
                    key={`${finding.title}:${finding.statement}`}
                    finding={finding}
                    anchorsById={anchorsById}
                    onAnchorClick={setAnchor}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="notes" className="pt-2">
              <div className="space-y-5">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="font-normal">
                    {t("run.aiWritten")}
                  </Badge>
                  <span className="text-[11.5px] text-muted-foreground">
                    {t("run.notesAiHint")}
                  </span>
                </div>

                <section className="space-y-1.5">
                  <h3 className="text-[13px] font-semibold">{t("run.notesSummaryTitle")}</h3>
                  <p className="text-[12.5px] leading-relaxed">{result.report.executiveSummary}</p>
                </section>

                {result.report.topConcerns.length > 0 && (
                  <section className="space-y-1.5">
                    <h3 className="text-[13px] font-semibold">{t("run.notesConcernsTitle")}</h3>
                    <ol className="list-decimal space-y-1 pl-5 text-[12.5px] leading-relaxed">
                      {result.report.topConcerns.map((concern) => (
                        <li key={concern}>{concern}</li>
                      ))}
                    </ol>
                  </section>
                )}

                {result.report.recommendedTests.length > 0 && (
                  <section className="space-y-1.5">
                    <h3 className="text-[13px] font-semibold">{t("run.notesTestsTitle")}</h3>
                    <ul className="list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed">
                      {result.report.recommendedTests.map((test) => (
                        <li key={test}>{test}</li>
                      ))}
                    </ul>
                  </section>
                )}

                {result.report.unknowns.length > 0 && (
                  <section className="space-y-1.5">
                    <h3 className="text-[13px] font-semibold">{t("run.notesUnknownsTitle")}</h3>
                    <ul className="list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-muted-foreground">
                      {result.report.unknowns.map((unknown) => (
                        <li key={unknown}>{unknown}</li>
                      ))}
                    </ul>
                  </section>
                )}

                <section className="space-y-2">
                  <h3 className="text-[13px] font-semibold">{t("run.verificationTitle")}</h3>
                  {result.verification.issues.length === 0 ? (
                    <p className="text-[12px] text-muted-foreground">
                      {t("run.verificationIssuesEmpty")}
                    </p>
                  ) : (
                    <details className="rounded-lg border border-border/60 p-3">
                      <summary className="cursor-pointer text-[12px] font-medium">
                        {t("run.verificationIssuesTitle", {
                          count: result.verification.issues.length,
                        })}
                      </summary>
                      <ul className="mt-2 max-h-60 space-y-1.5 overflow-y-auto text-[11.5px]">
                        {result.verification.issues.map((issue) => (
                          <li
                            key={`${issue.pass}|${issue.kind}|${issue.target}|${issue.detail.slice(0, 80)}`}
                            className="leading-relaxed"
                          >
                            <span className="font-mono text-[10.5px] text-muted-foreground">
                              {issue.pass} · {issue.kind}
                            </span>
                            <span className="text-muted-foreground"> — </span>
                            {issue.detail}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <p className="text-[11.5px] text-muted-foreground">
                    {t("run.contextCounts", {
                      changeFacts: result.contextManifest.counts.changeFacts,
                      linked: result.contextManifest.counts.linked,
                      contextItems: result.contextManifest.counts.contextItems,
                      evidence: result.contextManifest.counts.evidence,
                      dropped: result.contextManifest.counts.evidenceDropped,
                    })}
                  </p>
                  {result.contextManifest.notes.map((note) => (
                    <p key={note} className="text-[11.5px] text-muted-foreground">
                      {note}
                    </p>
                  ))}
                </section>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}

      <EvidenceDialog anchor={anchor} onOpenChange={(open) => !open && setAnchor(null)} />
    </div>
  );
}

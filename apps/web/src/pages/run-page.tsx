import type {
  Anchor,
  ReviewPassMeta,
  ReviewRunResult,
  ReviewStreamEvent,
  Verdict,
} from "@craftland-qa/contracts";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { cn } from "cn";
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  GitCompareArrows,
  Info,
  Loader2,
  MessageCircleQuestion,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ChangeFacts } from "@/components/report/change-facts";
import { EngineFindingCard } from "@/components/report/engine-finding-card";
import { EvidenceDialog } from "@/components/report/evidence-dialog";
import { FindingCard } from "@/components/report/finding-card";
import { ThemeMap } from "@/components/report/theme-map";
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

const STAGE_ORDER = ["digest", "map", "read", "dig", "synthesize"] as const;
type StageName = (typeof STAGE_ORDER)[number];

const STAGE_LABEL_KEYS: Record<StageName, string> = {
  digest: "run.stageDigest",
  map: "run.stageMap",
  read: "run.stageRead",
  dig: "run.stageDig",
  synthesize: "run.stageSynthesize",
};

interface StageState {
  readonly state: "pending" | "active" | "done";
  readonly latencyMs?: number;
  readonly unit?: number;
  readonly units?: number;
  readonly chunk?: number;
  readonly chunks?: number;
  readonly round?: number;
}

/** Fold the streamed stage events into one state per pipeline stage. */
function stageStates(events: readonly ReviewStreamEvent[]): Record<StageName, StageState> {
  const states: Record<StageName, StageState> = {
    digest: { state: "pending" },
    map: { state: "pending" },
    read: { state: "pending" },
    dig: { state: "pending" },
    synthesize: { state: "pending" },
  };
  for (const event of events) {
    if (event.type !== "stage") continue;
    const progress = {
      ...(event.unit === undefined || event.units === undefined
        ? {}
        : { unit: event.unit, units: event.units }),
      ...(event.chunk === undefined || event.chunks === undefined
        ? {}
        : { chunk: event.chunk, chunks: event.chunks }),
      ...(event.round === undefined ? {} : { round: event.round }),
    };
    states[event.stage] =
      event.state === "started"
        ? { state: "active", ...progress }
        : {
            state: "done",
            ...progress,
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

const PASS_LABEL_KEYS: Record<ReviewPassMeta["pass"], string> = {
  map: "run.passMap",
  read: "run.passRead",
  dig: "run.passDig",
  synthesize: "run.passSynthesize",
  whatif: "run.passWhatIf",
};

const SALVAGE_LABEL_KEYS: Record<ReviewPassMeta["salvage"], string> = {
  clean: "run.salvageClean",
  stripped: "run.salvageStripped",
  fence: "run.salvageFence",
  braces: "run.salvageBraces",
  "text-fallback": "run.salvageTextFallback",
};

interface PassGroup {
  readonly pass: ReviewPassMeta["pass"];
  readonly salvage: ReviewPassMeta["salvage"];
  readonly calls: number;
  readonly ms: number;
}

/** Group the per-call pass log by pass + salvage rung so the summary shows one row per kind. */
function groupPasses(passes: readonly ReviewPassMeta[]): PassGroup[] {
  const groups = new Map<string, PassGroup>();
  for (const meta of passes) {
    const key = `${meta.pass}|${meta.salvage}`;
    const current = groups.get(key);
    if (current === undefined) {
      groups.set(key, { pass: meta.pass, salvage: meta.salvage, calls: 1, ms: meta.latencyMs });
    } else {
      groups.set(key, { ...current, calls: current.calls + 1, ms: current.ms + meta.latencyMs });
    }
  }
  return [...groups.values()];
}

/**
 * "Tổng quan lượt chạy" — the run's own account of what happened, directly under the verdict.
 * The executive summary is visible with zero clicks; concerns/tests/unknowns/process open on demand.
 * Verification numbers live in the verdict band, so they are not repeated here.
 */
function RunSummaryCard({ result }: { readonly result: ReviewRunResult }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const groups = groupPasses(result.passes);
  const totalMs = result.passes.reduce((sum, meta) => sum + meta.latencyMs, 0);
  const dropped = result.contextManifest.counts.evidenceDropped;
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{t("run.summaryTitle")}</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? t("run.summaryCollapse") : t("run.summaryExpand")}
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
          </Button>
        </div>
        <p className={cn("text-[12.5px] leading-relaxed", !open && "line-clamp-3")}>
          {result.report.executiveSummary}
        </p>
        {!open && result.report.topConcerns.length > 0 && (
          <p className="text-[11.5px] text-muted-foreground">
            {t("run.summaryMoreConcerns", { count: result.report.topConcerns.length })}
          </p>
        )}
        {open && (
          <div className="space-y-4">
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
            <div className="space-y-1.5 border-t border-border/60 pt-3">
              <h3 className="text-[13px] font-semibold">{t("run.summaryProcessTitle")}</h3>
              <p className="text-[11.5px] text-muted-foreground">
                {t("run.summaryProcess", {
                  calls: result.passes.length,
                  duration: formatDuration(totalMs),
                })}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {groups.map((group) => (
                  <Badge
                    key={`${group.pass}:${group.salvage}`}
                    variant="secondary"
                    className="font-normal"
                  >
                    {t(PASS_LABEL_KEYS[group.pass])}
                    {group.calls > 1 ? ` ×${group.calls}` : ""} · {group.ms} ms ·{" "}
                    {t(SALVAGE_LABEL_KEYS[group.salvage])}
                  </Badge>
                ))}
              </div>
              {dropped > 0 && (
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  {t("run.coverageNote", {
                    evidence: result.contextManifest.counts.evidence,
                    total: result.contextManifest.counts.evidence + dropped,
                    percent: Math.round(
                      (result.contextManifest.counts.evidence /
                        (result.contextManifest.counts.evidence + dropped)) *
                        100,
                    ),
                  })}
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Run report (E5, report v2 at E7.4, reading flow rebuilt in the UI epic) — live progress while
 * the run executes, then: verdict band → collapsible "Tổng quan lượt chạy" → tabs with AI findings
 * first, engine findings (the FACT layer) separately, the change map, and technical notes.
 * Every citation opens the exact anchored span in the evidence dialog.
 */
export function RunPage() {
  const { runId } = useParams({ from: "/runs/$runId" });
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projects } = useProject();
  const runQuery = useRun(runId);
  const { events, streamError } = useRunStream(runId);
  const cancelRun = useCancelReview();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [tab, setTab] = useState("findings");
  const [expandAll, setExpandAll] = useState(false);
  const [themeFilter, setThemeFilter] = useState<string | null>(null);
  const [showRawChanges, setShowRawChanges] = useState(false);

  const run = runQuery.data;
  const projectName =
    run === undefined
      ? null
      : (projects.find((project) => project.id === run.projectId)?.name ?? null);

  const lastStatusRef = useRef<string | null>(null);
  /**
   * Toast only on a live transition this page witnessed — a run completed in the past replays
   * its terminal SSE event on mount, and that must not announce "completed" again.
   */
  useEffect(() => {
    const status = run?.status ?? null;
    if (status === null) return;
    const previous = lastStatusRef.current;
    lastStatusRef.current = status;
    if (previous === null) return;
    if (previous !== "queued" && previous !== "running") return;
    if (status === "completed") toast.success(t("run.completedToast"));
    else if (status === "failed") toast.error(t("run.failedToast"));
    else if (status === "cancelled") toast(t("run.cancelledToast"));
  }, [run, t]);

  const digestQuery = useDigest(
    run !== undefined && run.status === "completed" ? run.projectId : null,
    run?.baseRef ?? null,
    run?.currentRef ?? null,
  );
  const anchorsById = useMemo(
    () => new Map((digestQuery.data?.anchors ?? []).map((item) => [item.id, item])),
    [digestQuery.data],
  );
  const engineFindings = useMemo(() => {
    const rank = { critical: 0, major: 1, minor: 2, info: 3 } as const;
    return [...(digestQuery.data?.findings ?? [])].sort(
      (a, b) => rank[a.severity] - rank[b.severity] || (a.id < b.id ? -1 : 1),
    );
  }, [digestQuery.data]);
  /** AI findings: severity first, then verified before "Cần xác minh" (unknown), then title. */
  const aiFindings = useMemo(() => {
    const severityRank = { critical: 0, major: 1, minor: 2, info: 3 } as const;
    const confidenceRank = (confidence: string) =>
      confidence === "unknown" ? 2 : confidence === "inferred" ? 1 : 0;
    return [...(run?.result?.report.findings ?? [])].sort(
      (a, b) =>
        severityRank[a.severity] - severityRank[b.severity] ||
        confidenceRank(a.confidence) - confidenceRank(b.confidence) ||
        (a.title < b.title ? -1 : 1),
    );
  }, [run]);
  const anchorFileById = useMemo(
    () =>
      new Map(
        (digestQuery.data?.anchors ?? []).map(
          (anchorItem) => [anchorItem.id, anchorItem.file] as const,
        ),
      ),
    [digestQuery.data],
  );
  const themeFileSet = useMemo(() => {
    const theme = run?.result?.themes.find((item) => item.id === themeFilter);
    return theme === undefined ? null : new Set(theme.files);
  }, [run, themeFilter]);

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

  const themeFilterName =
    themeFilter === null
      ? null
      : (result?.themes.find((theme) => theme.id === themeFilter)?.name ?? themeFilter);
  const inTheme = (anchors: readonly string[]): boolean => {
    if (themeFileSet === null) return true;
    const first = anchors[0];
    return first !== undefined && themeFileSet.has(anchorFileById.get(first) ?? "");
  };
  const visibleAi = aiFindings.filter((finding) => inTheme(finding.anchors));
  const visibleEngine = engineFindings.filter((finding) => inTheme(finding.anchors));

  const runRefs = {
    projectId: run.projectId,
    base: run.baseRef,
    current: run.currentRef,
  };

  function handleAskAbout(title: string): void {
    void navigate({
      to: "/what-if",
      search: { ...runRefs, q: title },
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("run.title")}
        description={t("run.description")}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link
                to="/what-if"
                search={{
                  projectId: run.projectId,
                  base: run.baseRef,
                  current: run.currentRef,
                }}
              >
                <MessageCircleQuestion className="size-4" />
                {t("run.askAboutChange")}
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link
                to="/compare"
                search={{
                  projectId: run.projectId,
                  base: run.baseRef,
                  current: run.currentRef,
                  preset: "custom",
                  ...(run.goal === null || run.goal === "" ? {} : { goal: run.goal }),
                }}
              >
                <GitCompareArrows className="size-4" />
                {t("run.backToCompare")}
              </Link>
            </Button>
          </div>
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
          <CardHeader className="flex flex-row items-center justify-between">
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
                  onError: () => toast.error(t("run.failedToast")),
                });
              }}
            >
              <Ban className="size-3.5" />
              {cancelRun.isPending ? t("run.cancelling") : t("run.cancelRun")}
            </Button>
          </CardHeader>
          <CardContent className="space-y-2" aria-live="polite">
            {STAGE_ORDER.map((stage) => {
              const state = states[stage];
              const metas: string[] = [];
              if (stage === "read" && state.unit !== undefined) {
                metas.push(t("run.stageReadProgress", { unit: state.unit, units: state.units }));
              }
              if (
                stage === "read" &&
                state.chunk !== undefined &&
                state.chunks !== undefined &&
                state.chunks > 1
              ) {
                metas.push(t("run.chunkProgress", { chunk: state.chunk, chunks: state.chunks }));
              }
              if (
                (stage === "read" || stage === "synthesize") &&
                state.round !== undefined &&
                state.round > 1
              ) {
                metas.push(t("run.roundProgress", { round: state.round }));
              }
              if (state.latencyMs !== undefined) {
                metas.push(t("run.passLatency", { ms: state.latencyMs }));
              }
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
                  {metas.map((meta) => (
                    <span key={meta} className="text-[11.5px] text-muted-foreground tabular-nums">
                      · {meta}
                    </span>
                  ))}
                </div>
              );
            })}
            <p className="pt-1 text-[11.5px] text-muted-foreground">{t("run.progressNote")}</p>
            {streamError && (
              <p className="text-[11.5px] text-amber-600 dark:text-amber-400">
                {t("run.streamReconnecting")}
              </p>
            )}
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
            </CardContent>
          </Card>

          <RunSummaryCard result={result} />

          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(value);
              if (value !== "changes") setShowRawChanges(false);
            }}
          >
            <TabsList>
              <TabsTrigger value="findings">
                {t("run.tabFindings")} ({aiFindings.length})
              </TabsTrigger>
              <TabsTrigger value="engine">
                {t("run.tabEngine")} ({engineFindings.length})
              </TabsTrigger>
              <TabsTrigger value="changes">{t("run.tabChanges")}</TabsTrigger>
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
                <div className="space-y-4">
                  <ThemeMap
                    themes={result.themes}
                    narratives={result.report.themes}
                    digest={digestQuery.data}
                    engineFindings={engineFindings}
                    aiFindings={aiFindings}
                    anchorsById={anchorsById}
                    onAnchorClick={setAnchor}
                    onShowFindings={(themeId) => {
                      setThemeFilter(themeId);
                      setTab("findings");
                    }}
                  />
                  <details
                    className="rounded-lg border border-border/60 p-3"
                    onToggle={(event) => setShowRawChanges(event.currentTarget.open)}
                  >
                    <summary className="cursor-pointer text-[12px] font-medium">
                      {t("run.rawDetailsTitle")}
                    </summary>
                    {showRawChanges && (
                      <div className="pt-3">
                        <ChangeFacts
                          digest={digestQuery.data}
                          anchorsById={anchorsById}
                          onAnchorClick={setAnchor}
                        />
                      </div>
                    )}
                  </details>
                </div>
              )}
            </TabsContent>

            <TabsContent value="findings" className="space-y-3 pt-2">
              {themeFilter !== null && (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="font-normal">
                    {t("run.themeFilterLabel")}: {themeFilterName ?? themeFilter}
                  </Badge>
                  <Button variant="ghost" size="sm" onClick={() => setThemeFilter(null)}>
                    {t("run.themeFilterClear")}
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                  {t("run.aiFindingsHint")}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setExpandAll((value) => !value)}
                >
                  {expandAll ? t("run.collapseAll") : t("run.expandAll")}
                </Button>
              </div>
              {visibleAi.length === 0 ? (
                <p className="text-[12.5px] text-muted-foreground">{t("run.findingsEmpty")}</p>
              ) : (
                visibleAi.map((finding) => (
                  <FindingCard
                    key={`${expandAll ? "open" : "closed"}:${finding.title}:${finding.statement}`}
                    finding={finding}
                    anchorsById={anchorsById}
                    onAnchorClick={setAnchor}
                    defaultOpen={expandAll}
                    onAsk={handleAskAbout}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="engine" className="space-y-3 pt-2">
              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                {t("run.engineFindingsHint")}
              </p>
              {visibleEngine.length === 0 ? (
                <p className="text-[12.5px] text-muted-foreground">{t("run.engineEmpty")}</p>
              ) : (
                visibleEngine.map((finding) => (
                  <EngineFindingCard
                    key={`${expandAll ? "open" : "closed"}:${finding.id}`}
                    finding={finding}
                    anchorsById={anchorsById}
                    onAnchorClick={setAnchor}
                    defaultOpen={expandAll}
                    onAsk={handleAskAbout}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="notes" className="pt-2">
              <div className="space-y-5">
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
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {issue.pass} · {issue.kind}
                            </span>
                            <span className="text-muted-foreground"> — </span>
                            {issue.detail}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </section>

                <section className="space-y-1.5">
                  <h3 className="text-[13px] font-semibold">{t("run.notesContextTitle")}</h3>
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

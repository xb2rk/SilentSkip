import {
  type Anchor,
  type ReviewLens,
  ReviewLensSchema,
  type ReviewPassMeta,
  type ReviewRunResult,
  type Verdict,
} from "@silentskip/contracts";
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
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ChangeFacts } from "@/components/report/change-facts";
import { EngineFindingCard } from "@/components/report/engine-finding-card";
import { EvidenceDialog } from "@/components/report/evidence-dialog";
import { type ChangeAttribution, FindingCard } from "@/components/report/finding-card";
import { SurfacesBoard } from "@/components/report/surfaces-board";
import { ThemeMap } from "@/components/report/theme-map";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProject } from "@/contexts/project-context";
import { formatBytes, formatDateTime, formatDuration } from "@/lib/format";
import { STAGE_ORDER, type StageName, stageStates, stageTotals } from "@/lib/stage-progress";
import { useDigest } from "@/lib/use-projects";
import { useRunStream } from "@/lib/use-run-stream";
import { useAttribution, useCancelReview, useRun, useStartReview } from "@/lib/use-runs";

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

const STAGE_LABEL_KEYS: Record<StageName, string> = {
  digest: "run.stageDigest",
  map: "run.stageMap",
  read: "run.stageRead",
  dig: "run.stageDig",
  synthesize: "run.stageSynthesize",
};

/** One line per stage saying what that stage does — the pipeline used to be a black box (R2). */
const STAGE_HINT_KEYS: Record<StageName, string> = {
  digest: "run.stageDigestHint",
  map: "run.stageMapHint",
  read: "run.stageReadHint",
  dig: "run.stageDigHint",
  synthesize: "run.stageSynthesizeHint",
};

/** The run's stored lens, only when it still parses — a stale row must not block "Chạy lại". */
function rerunLensOf(lens: string | null): ReviewLens | undefined {
  const parsed = ReviewLensSchema.safeParse(lens);
  return parsed.success ? parsed.data : undefined;
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

export const SALVAGE_LABEL_KEYS: Record<ReviewPassMeta["salvage"], string> = {
  clean: "run.salvageClean",
  stripped: "run.salvageStripped",
  fence: "run.salvageFence",
  braces: "run.salvageBraces",
  "text-fallback": "run.salvageTextFallback",
};

const ISSUE_KIND_LABEL_KEYS: Record<string, string> = {
  "unknown-anchor": "run.issueKindUnknownAnchor",
  "new-anchor": "run.issueKindNewAnchor",
  "finding-unanchored": "run.issueKindFindingUnanchored",
  "unknown-fact": "run.issueKindUnknownFact",
  "free-number": "run.issueKindFreeNumber",
  "claim-invalid": "run.issueKindClaimInvalid",
  "claim-false": "run.issueKindClaimFalse",
  "quote-unverified": "run.issueKindQuoteUnverified",
  "theme-invalid": "run.issueKindThemeInvalid",
  "map-invalid": "run.issueKindMapInvalid",
  "read-invalid": "run.issueKindReadInvalid",
  "dig-invalid": "run.issueKindDigInvalid",
  "synthesize-invalid": "run.issueKindSynthesizeInvalid",
  "verdict-downgraded": "run.issueKindVerdictDowngraded",
  "map-timeout": "run.issueKindMapTimeout",
  "read-timeout": "run.issueKindReadTimeout",
  "dig-timeout": "run.issueKindDigTimeout",
  "synthesize-timeout": "run.issueKindSynthesizeTimeout",
  "map-unavailable": "run.issueKindMapUnavailable",
  "read-unavailable": "run.issueKindReadUnavailable",
  "dig-unavailable": "run.issueKindDigUnavailable",
  "synthesize-unavailable": "run.issueKindSynthesizeUnavailable",
};

interface PassGroup {
  readonly pass: ReviewPassMeta["pass"];
  readonly salvage: ReviewPassMeta["salvage"];
  readonly cached: boolean;
  readonly calls: number;
  readonly ms: number;
  /** Payload bytes the group's calls sent; 0 for runs recorded before the measurement existed. */
  readonly bytes: number;
}

/**
 * Group the per-call pass log by pass + salvage rung (+ cache) so the summary shows one row per
 * kind. Cached calls are grouped apart on purpose: they cost no AI time, and mixing them into a
 * live group would misreport what the workflow actually did.
 */
function groupPasses(passes: readonly ReviewPassMeta[]): PassGroup[] {
  const groups = new Map<string, PassGroup>();
  for (const meta of passes) {
    const key = `${meta.pass}|${meta.salvage}|${meta.cached ? "cached" : "live"}`;
    const current = groups.get(key);
    if (current === undefined) {
      groups.set(key, {
        pass: meta.pass,
        salvage: meta.salvage,
        cached: meta.cached,
        calls: 1,
        ms: meta.latencyMs,
        bytes: meta.payloadBytes,
      });
    } else {
      groups.set(key, {
        ...current,
        calls: current.calls + 1,
        ms: current.ms + meta.latencyMs,
        bytes: current.bytes + meta.payloadBytes,
      });
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
        <p className={cn("text-body leading-relaxed", !open && "line-clamp-3")}>
          {result.report.executiveSummary}
        </p>
        {!open && result.report.topConcerns.length > 0 && (
          <p className="text-meta text-muted-foreground">
            {t("run.summaryMoreConcerns", { count: result.report.topConcerns.length })}
          </p>
        )}
        {open && (
          <div className="space-y-4">
            {result.report.topConcerns.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-body font-semibold">{t("run.notesConcernsTitle")}</h3>
                <ol className="list-decimal space-y-1 pl-5 text-body leading-relaxed">
                  {result.report.topConcerns.map((concern) => (
                    <li key={concern}>{concern}</li>
                  ))}
                </ol>
              </section>
            )}
            {result.report.recommendedTests.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-body font-semibold">{t("run.notesTestsTitle")}</h3>
                <ul className="list-disc space-y-1 pl-5 text-body leading-relaxed">
                  {result.report.recommendedTests.map((test) => (
                    <li key={test}>{test}</li>
                  ))}
                </ul>
              </section>
            )}
            {result.report.unknowns.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-body font-semibold">{t("run.notesUnknownsTitle")}</h3>
                <ul className="list-disc space-y-1 pl-5 text-body leading-relaxed text-muted-foreground">
                  {result.report.unknowns.map((unknown) => (
                    <li key={unknown}>{unknown}</li>
                  ))}
                </ul>
              </section>
            )}
            <div className="space-y-1.5 border-t border-border/60 pt-3">
              <h3 className="text-body font-semibold">{t("run.summaryProcessTitle")}</h3>
              <p className="text-meta text-muted-foreground">
                {t("run.summaryProcess", {
                  calls: result.passes.length,
                  duration: formatDuration(totalMs),
                })}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {groups.map((group) => (
                  <Badge
                    key={`${group.pass}:${group.salvage}:${group.cached ? "cached" : "live"}`}
                    variant="secondary"
                    className="font-normal"
                  >
                    {t(PASS_LABEL_KEYS[group.pass])}
                    {group.calls > 1 ? ` ×${group.calls}` : ""} · {group.ms} ms ·{" "}
                    {group.bytes > 0 ? `${formatBytes(group.bytes)} · ` : ""}
                    {t(SALVAGE_LABEL_KEYS[group.salvage])}
                    {group.cached ? ` · ${t("run.passCached")}` : ""}
                  </Badge>
                ))}
              </div>
              {dropped > 0 && (
                <p className="text-meta leading-relaxed text-muted-foreground">
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
  const attributionQuery = useAttribution(runId);
  const { events, streamError } = useRunStream(runId);
  const cancelRun = useCancelReview();
  const startReview = useStartReview();
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

  const isLive = run?.status === "queued" || run?.status === "running";
  const [nowTick, setNowTick] = useState(() => Date.now());
  /** Live elapsed clock: a run that takes fifteen minutes needs a number that moves, not a spinner. */
  useEffect(() => {
    if (!isLive) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isLive]);

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

  // The digest backs the change map, engine findings and every anchor tooltip, so it is loaded
  // whenever a result exists — a degraded, cancelled or failed run keeps those tabs useful (E3).
  const digestQuery = useDigest(
    run?.result != null ? run.projectId : null,
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

  /** File -> newest commit that touched it (E9.3), used for the "Ai đổi?" chip. */
  const attributionByFile = useMemo(() => {
    const map = new Map<string, ChangeAttribution>();
    for (const file of attributionQuery.data?.files ?? []) {
      const latest = file.commits[0];
      if (latest === undefined) {
        if (file.changedInWorktree) {
          map.set(file.path, {
            author: t("run.attributionUncommitted"),
            short: "",
            date: "",
            subject: "",
            changedInWorktree: true,
          });
        }
        continue;
      }
      map.set(file.path, {
        author: latest.author,
        short: latest.short,
        date: latest.date,
        subject: latest.subject,
        changedInWorktree: file.changedInWorktree,
      });
    }
    return map;
  }, [attributionQuery.data, t]);
  const attributionOf = (anchors: readonly string[]): ChangeAttribution | undefined => {
    for (const anchorId of anchors) {
      const file = anchorFileById.get(anchorId);
      if (file === undefined) continue;
      const found = attributionByFile.get(file);
      if (found !== undefined) return found;
    }
    return undefined;
  };

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
  const running = isLive;
  const states = stageStates(events);
  const totals = stageTotals(states);
  /** Elapsed wall clock: ticking while the run is live, frozen to the stored duration after. */
  const elapsedMs = running
    ? Math.max(0, nowTick - new Date(run.createdAt).getTime())
    : (run.durationMs ?? 0);
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
  const surfaceChanges =
    result?.surfaces === null || result?.surfaces === undefined
      ? 0
      : result.surfaces.delta.newSilent.length + result.surfaces.delta.fixed.length;

  const runRefs = {
    projectId: run.projectId,
    base: run.baseRef,
    current: run.currentRef,
  };
  /** "Chạy lại" inputs, resolved here where `run` is narrowed to a real summary. */
  const rerunGoal = run.goal === null || run.goal === "" ? undefined : run.goal;
  const rerunLens = rerunLensOf(run.lens);

  function handleAskAbout(title: string): void {
    void navigate({
      to: "/what-if",
      search: { ...runRefs, q: title },
    });
  }

  /** Re-run the same comparison as a new run — the honest answer to "can I rerun this?". */
  function handleRerun(): void {
    startReview.mutate(
      {
        projectId: runRefs.projectId,
        baseRef: runRefs.base,
        currentRef: runRefs.current,
        ...(rerunGoal === undefined ? {} : { goal: rerunGoal }),
        ...(rerunLens === undefined ? {} : { lens: rerunLens }),
      },
      {
        onSuccess: (response) => {
          void navigate({ to: "/runs/$runId", params: { runId: response.runId } });
        },
        onError: () => toast.error(t("run.failedToast")),
      },
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("run.title")}
        description={t("run.description")}
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={startReview.isPending}
              title={t("run.rerunHint")}
              onClick={handleRerun}
            >
              <RotateCcw className="size-4" />
              {t("run.rerun")}
            </Button>
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
        <CardContent className="flex flex-wrap items-center gap-x-5 gap-y-2 text-meta">
          <span className="font-medium">{projectName ?? run.projectId}</span>
          <span className="font-mono text-meta" title={`${run.baseRef} → ${run.currentRef}`}>
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
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <Loader2 className="size-4 animate-spin text-primary" />
                {run.status === "queued" ? t("run.statusQueued") : t("run.statusRunning")}
              </CardTitle>
              <span className="text-meta text-muted-foreground tabular-nums">
                {t("run.progressElapsed", { elapsed: formatDuration(elapsedMs) })} ·{" "}
                {t("run.progressCalls", { calls: totals.calls })} ·{" "}
                {t("run.progressAiTime", { duration: formatDuration(totals.totalMs) })}
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={cancelRun.isPending}
              title={t("run.cancelKeepsPartial")}
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
              if (stage === "read" && state.units !== undefined) {
                metas.push(
                  t("run.stageReadProgress", { done: state.doneRegions, units: state.units }),
                );
              }
              if (
                stage === "read" &&
                state.chunk !== undefined &&
                state.chunks !== undefined &&
                state.chunks > 1
              ) {
                metas.push(t("run.chunkProgress", { chunk: state.chunk, chunks: state.chunks }));
              }
              if (state.round !== undefined && state.round > 1) {
                metas.push(t("run.roundProgress", { round: state.round }));
              }
              if (stage !== "digest" && state.calls > 0) {
                metas.push(t("run.stageCalls", { calls: state.calls }));
              }
              if (state.totalMs > 0) {
                metas.push(t("run.stageTotal", { duration: formatDuration(state.totalMs) }));
              }
              return (
                <div
                  key={stage}
                  className="flex items-center gap-2 text-body"
                  title={t(STAGE_HINT_KEYS[stage])}
                >
                  {state.state === "done" ? (
                    <CheckCircle2 className="size-4 text-positive dark:text-positive" />
                  ) : state.state === "active" ? (
                    <Loader2 className="size-4 animate-spin text-primary" />
                  ) : (
                    <span className="size-4 rounded-full border border-border" />
                  )}
                  <span className={cn(state.state === "pending" && "text-muted-foreground")}>
                    {t(STAGE_LABEL_KEYS[stage])}
                  </span>
                  {metas.map((meta) => (
                    <span key={meta} className="text-meta text-muted-foreground tabular-nums">
                      · {meta}
                    </span>
                  ))}
                </div>
              );
            })}
            <p className="pt-1 text-meta text-muted-foreground">{t("run.progressNote")}</p>
            <details className="pt-1 text-meta text-muted-foreground">
              <summary className="cursor-pointer select-none">{t("run.whySlowTitle")}</summary>
              <div className="space-y-1 pt-2">
                <p>
                  {t("run.whySlowSummary", {
                    calls: totals.calls,
                    duration: formatDuration(totals.totalMs),
                  })}
                </p>
                {totals.slowestStage !== null && (
                  <p>
                    {t("run.whySlowSlowest", {
                      duration: formatDuration(totals.slowestMs),
                      stage: t(STAGE_LABEL_KEYS[totals.slowestStage]),
                    })}
                  </p>
                )}
                {STAGE_ORDER.map((stage) => (
                  <p key={stage}>
                    <span className="text-foreground">{t(STAGE_LABEL_KEYS[stage])}</span> —{" "}
                    {t(STAGE_HINT_KEYS[stage])}
                  </p>
                ))}
                <p>{t("run.noPauseNote")}</p>
                <p>{t("run.cancelKeepsPartial")}</p>
              </div>
            </details>
            {streamError && (
              <p className="text-meta text-warning dark:text-warning">
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

      {result !== null && verification !== null && !running && (
        <>
          {result.fallbackReason !== null && (
            <Alert>
              <Info className="size-4" />
              <AlertTitle>{t("run.fallbackTitle")}</AlertTitle>
              <AlertDescription>{result.fallbackReason}</AlertDescription>
            </Alert>
          )}

          {result.degradedReason !== null && (
            <Alert>
              <Info className="size-4" />
              <AlertTitle>{t("run.degradedTitle")}</AlertTitle>
              <AlertDescription>{result.degradedReason}</AlertDescription>
            </Alert>
          )}

          <Card>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <span
                  className={cn(
                    "inline-flex h-7 items-center rounded-lg px-2.5 text-body font-semibold",
                    VERDICT_STYLES[result.report.verdict],
                  )}
                >
                  {t(VERDICT_LABEL_KEYS[result.report.verdict])}
                </span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xl font-semibold tabular-nums">
                    {result.report.qualityScore}
                  </span>
                  <span className="text-meta text-muted-foreground">/100</span>
                </div>
                <span className="text-meta text-muted-foreground">{t("run.scoreHint")}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-meta">
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
              <TabsTrigger value="surfaces">
                {t("run.tabSurfaces")} ({surfaceChanges})
              </TabsTrigger>
              <TabsTrigger value="changes">{t("run.tabChanges")}</TabsTrigger>
              <TabsTrigger value="notes">{t("run.tabNotes")}</TabsTrigger>
            </TabsList>

            <TabsContent value="changes" className="pt-2">
              {run.currentRef === "WORKTREE" && (
                <p className="mb-3 text-meta text-muted-foreground">
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
                    <summary className="cursor-pointer text-meta font-medium">
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
                <p className="text-meta leading-relaxed text-muted-foreground">
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
              {result.degradedReason !== null &&
                !result.passes.some((meta) => meta.pass === "synthesize") && (
                  <p className="text-meta leading-relaxed text-warning dark:text-warning">
                    {t("run.degradedFindingsHint")}
                  </p>
                )}
              {visibleAi.length === 0 ? (
                <p className="text-body text-muted-foreground">{t("run.findingsEmpty")}</p>
              ) : (
                visibleAi.map((finding) => (
                  <FindingCard
                    key={`${expandAll ? "open" : "closed"}:${finding.title}:${finding.statement}`}
                    finding={finding}
                    anchorsById={anchorsById}
                    onAnchorClick={setAnchor}
                    defaultOpen={expandAll}
                    onAsk={handleAskAbout}
                    attribution={attributionOf(finding.anchors)}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="engine" className="space-y-3 pt-2">
              <p className="text-meta leading-relaxed text-muted-foreground">
                {t("run.engineFindingsHint")}
              </p>
              {visibleEngine.length === 0 ? (
                <p className="text-body text-muted-foreground">{t("run.engineEmpty")}</p>
              ) : (
                visibleEngine.map((finding) => (
                  <EngineFindingCard
                    key={`${expandAll ? "open" : "closed"}:${finding.id}`}
                    finding={finding}
                    anchorsById={anchorsById}
                    onAnchorClick={setAnchor}
                    defaultOpen={expandAll}
                    onAsk={handleAskAbout}
                    attribution={attributionOf(finding.anchors)}
                  />
                ))
              )}
            </TabsContent>

            <TabsContent value="surfaces" className="pt-2">
              {result.surfaces === null ? (
                <p className="text-body text-muted-foreground">{t("run.surfacesLegacy")}</p>
              ) : (
                <SurfacesBoard
                  surface={result.surfaces}
                  anchorsById={anchorsById}
                  onAnchorClick={setAnchor}
                />
              )}
            </TabsContent>

            <TabsContent value="notes" className="pt-2">
              <div className="space-y-5">
                <section className="space-y-2">
                  <h3 className="text-body font-semibold">{t("run.verificationTitle")}</h3>
                  {result.verification.issues.length === 0 ? (
                    <p className="text-meta text-muted-foreground">
                      {t("run.verificationIssuesEmpty")}
                    </p>
                  ) : (
                    <details className="rounded-lg border border-border/60 p-3">
                      <summary className="cursor-pointer text-meta font-medium">
                        {t("run.verificationIssuesTitle", {
                          count: result.verification.issues.length,
                        })}
                      </summary>
                      <ul className="mt-2 max-h-60 space-y-1.5 overflow-y-auto text-meta">
                        {result.verification.issues.map((issue) => (
                          <li
                            key={`${issue.pass}|${issue.kind}|${issue.target}|${issue.detail.slice(0, 80)}`}
                            className="leading-relaxed"
                          >
                            <span className="font-mono text-micro text-muted-foreground">
                              {t(PASS_LABEL_KEYS[issue.pass] ?? issue.pass)} ·{" "}
                              {t(ISSUE_KIND_LABEL_KEYS[issue.kind] ?? issue.kind)}
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
                  <h3 className="text-body font-semibold">{t("run.notesContextTitle")}</h3>
                  <p className="text-meta text-muted-foreground">
                    {t("run.contextCounts", {
                      changeFacts: result.contextManifest.counts.changeFacts,
                      linked: result.contextManifest.counts.linked,
                      contextItems: result.contextManifest.counts.contextItems,
                      evidence: result.contextManifest.counts.evidence,
                      dropped: result.contextManifest.counts.evidenceDropped,
                    })}
                  </p>
                  {result.contextManifest.notes.map((note) => (
                    <p key={note} className="text-meta text-muted-foreground">
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

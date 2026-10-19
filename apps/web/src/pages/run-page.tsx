import {
  type Anchor,
  type ReviewLens,
  ReviewLensSchema,
  type ReviewRunResult,
} from "@silentskip/contracts";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  Clock,
  FolderGit2,
  GitBranch,
  GitCompareArrows,
  Info,
  MessageCircleQuestion,
  RotateCcw,
  Target,
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
import { HeroVerdictBanner } from "@/components/report/hero-verdict-banner";
import { RunLiveProgress } from "@/components/report/run-live-progress";
import { RunSummaryCard } from "@/components/report/run-summary-card";
import { RunVerificationNotes } from "@/components/report/run-verification-notes";
import { SurfacesBoard } from "@/components/report/surfaces-board";
import { ThemeMap } from "@/components/report/theme-map";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCopilot } from "@/contexts/copilot-context";
import { useProject } from "@/contexts/project-context";
import { formatDateTime, formatDuration } from "@/lib/format";
import { useDigest } from "@/lib/use-projects";
import { useRunStream } from "@/lib/use-run-stream";
import { useAttribution, useCancelReview, useRun, useStartReview } from "@/lib/use-runs";

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

/**
 * Run report (E5, modernized v3):
 * - Live animated command center while running
 * - Hero Verdict Banner with quality score and 4-KPI counters
 * - In-context Copilot Drawer integration
 * - Modularized tabs: AI Findings, Engine Findings, Surfaces, Change Map, Technical Notes.
 */
export function RunPage() {
  const { runId } = useParams({ from: "/runs/$runId" });
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { projects } = useProject();
  const { openCopilot } = useCopilot();
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

  useEffect(() => {
    if (!isLive) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isLive]);

  const lastStatusRef = useRef<string | null>(null);
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

  const criticalCount = useMemo(
    () =>
      aiFindings.filter((f) => f.severity === "critical").length +
      engineFindings.filter((f) => f.severity === "critical").length,
    [aiFindings, engineFindings],
  );
  const majorCount = useMemo(
    () =>
      aiFindings.filter((f) => f.severity === "major").length +
      engineFindings.filter((f) => f.severity === "major").length,
    [aiFindings, engineFindings],
  );
  const minorCount = useMemo(
    () =>
      aiFindings.filter((f) => f.severity === "minor").length +
      engineFindings.filter((f) => f.severity === "minor").length,
    [aiFindings, engineFindings],
  );
  const infoCount = useMemo(
    () =>
      aiFindings.filter((f) => f.severity === "info").length +
      engineFindings.filter((f) => f.severity === "info").length,
    [aiFindings, engineFindings],
  );

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
  const rerunGoal = run.goal === null || run.goal === "" ? undefined : run.goal;
  const rerunLens = rerunLensOf(run.lens);

  function handleAskAbout(title: string): void {
    if (run === undefined) return;
    openCopilot({
      projectId: run.projectId,
      baseRef: run.baseRef,
      currentRef: run.currentRef,
      runId: run.id,
      initialQuestion: title,
    });
  }

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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                openCopilot({
                  projectId: run.projectId,
                  baseRef: run.baseRef,
                  currentRef: run.currentRef,
                  runId: run.id,
                })
              }
              title={t("run.askAboutChange")}
            >
              <MessageCircleQuestion className="size-4" />
              {t("run.askAboutChange")}
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

      {/* Devtool Metadata Ribbon */}
      <Card className="surface overflow-hidden">
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2.5 py-3 text-meta">
          <div className="flex items-center gap-1.5 font-semibold text-foreground">
            <FolderGit2 className="size-4 text-primary" />
            <span>{projectName ?? run.projectId}</span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-meta text-foreground/90">
            <GitBranch className="size-3.5 text-muted-foreground" />
            <span className="font-medium text-foreground">{run.baseRef}</span>
            <span className="text-muted-foreground">→</span>
            <span className="font-medium text-primary">{run.currentRef}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="size-3.5" />
            <span>{formatDateTime(run.createdAt)}</span>
          </div>
          {run.durationMs !== null && (
            <div className="flex items-center gap-1.5 text-muted-foreground tabular-nums">
              <span>{formatDuration(run.durationMs)}</span>
            </div>
          )}
          {run.goal !== null && run.goal !== "" && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Target className="size-3.5 text-primary" />
              <span className="font-medium text-foreground">{run.goal}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Live Animated Pipeline Command Center */}
      {running && (
        <RunLiveProgress
          runId={runId}
          status={run.status as "queued" | "running"}
          elapsedMs={elapsedMs}
          events={events}
          streamError={streamError}
          onCancel={() => {
            cancelRun.mutate(runId, {
              onError: () => toast.error(t("run.failedToast")),
            });
          }}
          isCancelling={cancelRun.isPending}
        />
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

      {/* Completed Report View */}
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

          {/* Hero Verdict Banner */}
          <HeroVerdictBanner
            verdict={result.report.verdict}
            qualityScore={result.report.qualityScore}
            verification={verification}
            criticalCount={criticalCount}
            majorCount={majorCount}
            minorCount={minorCount}
            infoCount={infoCount}
            durationMs={run.durationMs}
            onAskCopilot={() =>
              openCopilot({
                projectId: run.projectId,
                baseRef: run.baseRef,
                currentRef: run.currentRef,
                runId: run.id,
                initialQuestion: `Hãy giải thích chi tiết vì sao lượt chạy này có kết quả ${result.report.verdict} và điểm chất lượng là ${result.report.qualityScore}/100.`,
              })
            }
          />

          {/* Run Summary Card */}
          <RunSummaryCard result={result} />

          {/* Tabs for findings, engine facts, surfaces, changes, and notes */}
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
              <RunVerificationNotes result={result} />
            </TabsContent>
          </Tabs>
        </>
      )}

      <EvidenceDialog anchor={anchor} onOpenChange={(open) => !open && setAnchor(null)} />
    </div>
  );
}

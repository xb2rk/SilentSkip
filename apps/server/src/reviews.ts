import { randomUUID } from "node:crypto";
import {
  AiError,
  buildFallbackReport,
  type PassConfig,
  type PipelineCheckpoint,
  type PipelineStageEvent,
  runReviewPipeline,
  type WorkflowRunner,
} from "@silentskip/ai";
import {
  AppError,
  ErrorCodes,
  type ReviewRunResult,
  type ReviewStreamEvent,
  type RunDetailResponse,
  type RunSummary,
  type StartReviewRequest,
  WORKTREE_REF,
} from "@silentskip/contracts";
import { type AppDatabase, runs } from "@silentskip/db";
import { desc, eq } from "drizzle-orm";
import type { Logger } from "pino";
import { scheduleChannelEviction } from "./channel-retention";
import { loadDigest } from "./digest-input";
import { loadProjectProfile } from "./profiles";
import { getProject } from "./projects";
import {
  parseStoredResult,
  persistManifests,
  persistProgress,
  persistRunOutcome,
  readRunRow,
} from "./review-persistence";
import {
  CANCELLED_REASON,
  CHECKPOINT_REASON,
  fallbackResult,
  hasCheckpointWork,
  partialResult,
} from "./review-results";
import { SseChannel } from "./sse-channel";

export { reconcileInterruptedRuns } from "./review-persistence";

/**
 * Review manager (E4.4): owns the lifecycle of A/B review runs.
 *
 * - `startReview` persists a `runs` row and executes the pipeline in the background; the HTTP
 *   handler returns immediately with the run id (202).
 * - Progress is relayed through an in-memory `RunChannel` that replays every event to late
 *   subscribers, so the SSE endpoint works whether you connect before or after completion.
 * - Cancellation aborts the run's `AbortController`; the pipeline surfaces it as a `cancelled`
 *   terminal event and the row is persisted as `cancelled`.
 * - When the AI is unavailable (any `AiError` except cancellation) the run completes with the
 *   deterministic fallback report — the UI never depends on a flaky model call.
 * - Per-pass `context_manifests` rows persist exactly what was sent (counts + notes), the AI
 *   call statistics, and the verifier counters of that pass.
 */

/** Dependencies of the review manager. */
export interface ReviewManagerDeps {
  readonly db: AppDatabase;
  readonly log: Logger;
  readonly runner: WorkflowRunner;
  readonly config: PassConfig;
}

/**
 * Live event channel of one run — replay semantics live in `SseChannel` (shared with What-If).
 */
class RunChannel extends SseChannel<ReviewStreamEvent> {}

/** Cap of the run list endpoint — newest first; the History UI shows the latest slice. */
const RUN_LIST_LIMIT = 100;

/**
 * Explicit SQL column projection for RunSummary.
 * Excludes heavy multi-megabyte `report_json` and `diff_summary_json` blobs.
 */
const RUN_SUMMARY_COLUMNS = {
  id: runs.id,
  projectId: runs.projectId,
  baseRef: runs.baseRef,
  currentRef: runs.currentRef,
  goal: runs.goal,
  lens: runs.lens,
  status: runs.status,
  verdict: runs.verdict,
  qualityScore: runs.qualityScore,
  error: runs.error,
  durationMs: runs.durationMs,
  createdAt: runs.createdAt,
  completedAt: runs.completedAt,
};

type RunSummaryRow = {
  id: string;
  projectId: string;
  baseRef: string;
  currentRef: string;
  goal: string | null;
  lens: string | null;
  status: (typeof runs.$inferSelect)["status"];
  verdict: (typeof runs.$inferSelect)["verdict"];
  qualityScore: number | null;
  error: string | null;
  durationMs: number | null;
  createdAt: Date;
  completedAt: Date | null;
};

export class ReviewManager {
  private readonly deps: ReviewManagerDeps;
  private readonly channels = new Map<string, RunChannel>();
  private readonly controllers = new Map<string, AbortController>();

  constructor(deps: ReviewManagerDeps) {
    this.deps = deps;
  }

  /** Persist a new run and start it in the background. Returns the run id. */
  startReview(input: StartReviewRequest): string {
    const project = getProject(this.deps.db, input.projectId);
    if (input.baseRef === WORKTREE_REF) {
      throw new AppError(
        ErrorCodes.badRequest,
        "Bản gốc (A) phải là ref thật — không thể là bản đang làm",
      );
    }
    const runId = randomUUID();
    this.deps.db
      .insert(runs)
      .values({
        id: runId,
        projectId: project.id,
        baseRef: input.baseRef,
        currentRef: input.currentRef,
        goal: input.goal ?? null,
        lens: input.lens ?? null,
        status: "running",
        verdict: null,
        qualityScore: null,
        reportJson: null,
        diffSummaryJson: null,
        error: null,
        durationMs: null,
        createdAt: new Date(),
        completedAt: null,
      })
      .run();
    this.channels.set(runId, new RunChannel());
    this.controllers.set(runId, new AbortController());
    void this.execute(runId, project.rootPath, input).catch((error: unknown) => {
      this.deps.log.error({ err: error, runId }, "review task crashed");
    });
    return runId;
  }

  /** Abort a running review (no-op when it already finished). Returns the current detail. */
  cancel(runId: string): RunDetailResponse {
    const row = readRunRow(this.deps.db, runId);
    this.controllers.get(runId)?.abort();
    return this.detail(row);
  }

  /** Run summaries, newest first — optionally narrowed to one project (History page). */
  listRuns(projectId?: string): RunSummary[] {
    const base = this.deps.db.select(RUN_SUMMARY_COLUMNS).from(runs);
    const rows =
      projectId === undefined
        ? base.orderBy(desc(runs.createdAt)).limit(RUN_LIST_LIMIT).all()
        : base
            .where(eq(runs.projectId, projectId))
            .orderBy(desc(runs.createdAt))
            .limit(RUN_LIST_LIMIT)
            .all();
    return rows.map((row) => this.summary(row));
  }

  /** Run detail by id — throws NOT_FOUND for unknown ids. */
  getRun(runId: string): RunDetailResponse {
    return this.detail(readRunRow(this.deps.db, runId));
  }

  /**
   * Event channel of a run for the SSE route. Live runs use their channel; terminal runs get a
   * synthesised channel carrying a single terminal event, so `stream` always replays correctly.
   */
  channel(runId: string): RunChannel {
    const existing = this.channels.get(runId);
    if (existing !== undefined) return existing;
    const row = readRunRow(this.deps.db, runId);
    const channel = new RunChannel();
    const result = parseStoredResult(this.deps.log, row.id, row.reportJson);
    if (row.status === "completed") {
      void channel.emit({
        type: "completed",
        verdict: row.verdict ?? "insufficient_evidence",
        qualityScore: row.qualityScore ?? 0,
        findings: result?.report.findings.length ?? 0,
        fallbackReason: result?.fallbackReason ?? null,
        degradedReason: result?.degradedReason ?? null,
      });
    } else if (row.status === "cancelled") {
      void channel.emit({ type: "cancelled" });
    } else if (row.status === "failed") {
      void channel.emit({ type: "failed", error: row.error ?? "run failed" });
    }
    this.channels.set(runId, channel);
    scheduleChannelEviction(this.channels, runId);
    return channel;
  }

  private async execute(runId: string, rootPath: string, input: StartReviewRequest): Promise<void> {
    const channel = this.channels.get(runId);
    const controller = this.controllers.get(runId);
    if (channel === undefined || controller === undefined) return;
    const startedAt = Date.now();
    let digest: Awaited<ReturnType<typeof loadDigest>> | undefined;
    /** Latest partial result — upgraded, not discarded, if the run never finishes. */
    let checkpoint: PipelineCheckpoint | undefined;
    try {
      await channel.emit({ type: "stage", stage: "digest", state: "started" });
      digest = await loadDigest(
        rootPath,
        input.baseRef,
        input.currentRef,
        loadProjectProfile(this.deps.db, input.projectId),
      );
      await channel.emit({ type: "stage", stage: "digest", state: "completed" });
      const result = await runReviewPipeline(
        { runner: this.deps.runner, config: this.deps.config },
        {
          digest,
          ...(input.goal === undefined ? {} : { goal: input.goal }),
          ...(input.lens === undefined ? {} : { lens: input.lens }),
          signal: controller.signal,
          onEvent: (event) => this.relayStage(channel, event),
          onCheckpoint: (snapshot) => {
            checkpoint = snapshot;
            if (digest === undefined) return;
            // Write straight away: a crash between two calls must not lose the readings.
            persistProgress(
              this.deps.db,
              runId,
              JSON.stringify(partialResult(digest, snapshot, CHECKPOINT_REASON)),
            );
          },
        },
      );
      const persisted: ReviewRunResult = {
        report: result.report,
        passes: [...result.passes],
        themes: [...result.themes],
        verification: {
          read: result.verification.read,
          dig: result.verification.dig,
          synthesize: result.verification.synthesize,
          issues: [...result.verification.issues],
        },
        contextManifest: {
          counts: result.contextManifest.counts,
          notes: [...result.contextManifest.notes],
        },
        surfaces: result.surfaces,
        engineFindings: result.engineFindings,
        fallbackReason: null,
        degradedReason: result.degradedReason,
      };
      persistRunOutcome(this.deps.db, runId, {
        status: "completed",
        verdict: result.report.verdict,
        qualityScore: result.report.qualityScore,
        reportJson: JSON.stringify(persisted),
        diffSummaryJson: JSON.stringify(digest.stats),
        error: null,
        durationMs: Date.now() - startedAt,
      });
      persistManifests(this.deps.db, runId, result);
      scheduleChannelEviction(this.channels, runId);
      await channel.emit({
        type: "completed",
        verdict: result.report.verdict,
        qualityScore: result.report.qualityScore,
        findings: result.report.findings.length,
        fallbackReason: null,
        degradedReason: result.degradedReason,
      });
    } catch (error) {
      await this.failRun(runId, channel, controller, digest, error, startedAt, checkpoint);
    } finally {
      this.controllers.delete(runId);
    }
  }

  private async failRun(
    runId: string,
    channel: RunChannel,
    controller: AbortController,
    digest: Awaited<ReturnType<typeof loadDigest>> | undefined,
    error: unknown,
    startedAt: number,
    checkpoint: PipelineCheckpoint | undefined,
  ): Promise<void> {
    const durationMs = Date.now() - startedAt;
    const statsJson = digest === undefined ? null : JSON.stringify(digest.stats);
    /** The rescued partial result — null when there was nothing worth keeping. */
    const rescued =
      digest !== undefined && hasCheckpointWork(checkpoint) ? { digest, checkpoint } : null;
    const cancelled =
      controller.signal.aborted || (error instanceof AiError && error.code === "cancelled");
    if (cancelled) {
      // The user asked to stop, not to lose the readings: keep them.
      const partial =
        rescued === null
          ? null
          : partialResult(rescued.digest, rescued.checkpoint, CANCELLED_REASON);
      persistRunOutcome(this.deps.db, runId, {
        status: "cancelled",
        verdict: null,
        qualityScore: null,
        reportJson: partial === null ? null : JSON.stringify(partial),
        diffSummaryJson: statsJson,
        error: "Run cancelled by user",
        durationMs,
      });
      if (rescued !== null) persistManifests(this.deps.db, runId, rescued.checkpoint);
      scheduleChannelEviction(this.channels, runId);
      await channel.emit({ type: "cancelled" });
      return;
    }
    if (error instanceof AiError && digest !== undefined) {
      // The pipeline degrades on its own, so arriving here with work done means the run was cut
      // off mid-flight. Keep the readings; if nothing was read, the deterministic fallback states
      // exactly what happened.
      const reason = `AI review incomplete (${error.code}): ${error.message}`;
      const persisted: ReviewRunResult =
        rescued === null
          ? fallbackResult(digest, buildFallbackReport(digest, error))
          : partialResult(rescued.digest, rescued.checkpoint, reason);
      this.deps.log.warn(
        { runId, code: error.code, passes: persisted.passes.length },
        "review ended without a synthesised report",
      );
      persistRunOutcome(this.deps.db, runId, {
        status: "completed",
        verdict: persisted.report.verdict,
        qualityScore: persisted.report.qualityScore,
        reportJson: JSON.stringify(persisted),
        diffSummaryJson: statsJson,
        error: null,
        durationMs,
      });
      if (rescued !== null) persistManifests(this.deps.db, runId, rescued.checkpoint);
      scheduleChannelEviction(this.channels, runId);
      await channel.emit({
        type: "completed",
        verdict: persisted.report.verdict,
        qualityScore: persisted.report.qualityScore,
        findings: persisted.report.findings.length,
        fallbackReason: persisted.fallbackReason,
        degradedReason: persisted.degradedReason,
      });
      return;
    }
    const message = error instanceof Error ? error.message : "review run failed";
    this.deps.log.error({ err: error, runId }, "review run failed");
    // A genuine bug still shows what the AI had read — the run page renders partial results for
    // failed runs too (E3).
    const partial =
      rescued === null
        ? null
        : partialResult(
            rescued.digest,
            rescued.checkpoint,
            `Lượt chạy lỗi (${message}) — đây là phần AI đã đọc được trước khi dừng.`,
          );
    persistRunOutcome(this.deps.db, runId, {
      status: "failed",
      verdict: null,
      qualityScore: null,
      reportJson: partial === null ? null : JSON.stringify(partial),
      diffSummaryJson: statsJson,
      error: message,
      durationMs,
    });
    if (rescued !== null) persistManifests(this.deps.db, runId, rescued.checkpoint);
    scheduleChannelEviction(this.channels, runId);
    await channel.emit({ type: "failed", error: message });
  }

  private relayStage(channel: RunChannel, event: PipelineStageEvent): Promise<void> {
    return channel.emit({
      type: "stage",
      stage: event.stage,
      state: event.state,
      ...(event.latencyMs === undefined ? {} : { latencyMs: event.latencyMs }),
      ...(event.salvage === undefined ? {} : { salvage: event.salvage }),
      ...(event.unit === undefined ? {} : { unit: event.unit }),
      ...(event.units === undefined ? {} : { units: event.units }),
      ...(event.chunk === undefined ? {} : { chunk: event.chunk }),
      ...(event.chunks === undefined ? {} : { chunks: event.chunks }),
      ...(event.round === undefined ? {} : { round: event.round }),
    });
  }

  private summary(row: RunSummaryRow): RunSummary {
    return {
      id: row.id,
      projectId: row.projectId,
      baseRef: row.baseRef,
      currentRef: row.currentRef,
      goal: row.goal,
      lens: row.lens,
      status: row.status,
      verdict: row.verdict,
      qualityScore: row.qualityScore,
      error: row.error,
      durationMs: row.durationMs,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt === null ? null : row.completedAt.toISOString(),
    };
  }

  private detail(row: typeof runs.$inferSelect): RunDetailResponse {
    return {
      ...this.summary(row),
      result: parseStoredResult(this.deps.log, row.id, row.reportJson),
    };
  }
}

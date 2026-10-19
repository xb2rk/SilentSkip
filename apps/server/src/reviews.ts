import { randomUUID } from "node:crypto";
import {
  AiError,
  buildFallbackReport,
  buildPartialReport,
  type FallbackReport,
  type PassConfig,
  type PassMeta,
  type PipelineCheckpoint,
  type PipelineStageEvent,
  type PipelineVerification,
  runReviewPipeline,
  type WorkflowRunner,
} from "@silentskip/ai";
import {
  AppError,
  type DigestBundle,
  ErrorCodes,
  type ReviewContextManifest,
  type ReviewRunResult,
  type ReviewStreamEvent,
  type RunDetailResponse,
  type RunSummary,
  type StartReviewRequest,
  type VerifyStats,
  WORKTREE_REF,
} from "@silentskip/contracts";
import { type AppDatabase, contextManifests, runs } from "@silentskip/db";
import { desc, eq, inArray } from "drizzle-orm";
import type { Logger } from "pino";
import { loadDigest } from "./digest-input";
import { loadProjectProfile } from "./profiles";
import { getProject } from "./projects";
import { SseChannel } from "./sse-channel";

/**
 * Boot reconciliation: runs live in memory (channels + AbortControllers), so a process restart
 * orphans every row still marked queued/running. Leaving them "running" forever lies in History
 * and makes cancel a no-op. Mark them failed with an explicit reason; the user can start again.
 */
export function reconcileInterruptedRuns(db: AppDatabase): number {
  const pending = db
    .select({ id: runs.id })
    .from(runs)
    .where(inArray(runs.status, ["queued", "running"]))
    .all();
  if (pending.length === 0) return 0;
  db.update(runs)
    .set({
      status: "failed",
      error:
        "Máy chủ khởi động lại khi lượt review đang chạy — lượt này không hoàn tất. Hãy chạy lại.",
      completedAt: new Date(),
    })
    .where(
      inArray(
        runs.id,
        pending.map((row) => row.id),
      ),
    )
    .run();
  return pending.length;
}

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

/** Zeroed verifier stats for fallback results — no pass ran, nothing was verified. */
const ZERO_STATS: VerifyStats = {
  findingsChecked: 0,
  findingsStripped: 0,
  anchorsChecked: 0,
  anchorsStripped: 0,
  numbersChecked: 0,
  numbersUnverified: 0,
  quotesChecked: 0,
  quotesUnverified: 0,
  confidenceDowngraded: 0,
};

/** Cap of the run list endpoint — newest first; the History UI shows the latest slice. */
const RUN_LIST_LIMIT = 100;

/** How long completed SSE channels remain in memory for late replaying before eviction. */
const CHANNEL_RETENTION_TTL_MS = 10 * 60 * 1000; // 10 minutes

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

/** Reason recorded on a mid-run checkpoint — also what a server restart leaves behind. */
const CHECKPOINT_REASON =
  "Lượt chạy chưa tổng hợp xong — đây là phần AI đã đọc được trước khi dừng.";

/** Reason recorded when the user cancels a run that had already produced readings. */
const CANCELLED_REASON = "Đã huỷ lượt chạy — đây là phần AI đã đọc được trước khi huỷ.";

/**
 * A checkpoint is only worth rescuing when it carries work the user would otherwise lose: at
 * least one finished pass, or at least one verified reading. A checkpoint from a run whose very
 * first call failed has nothing to keep — the deterministic fallback tells that story better.
 */
function hasCheckpointWork(
  snapshot: PipelineCheckpoint | undefined,
): snapshot is PipelineCheckpoint {
  return (
    snapshot !== undefined &&
    (snapshot.passes.length > 0 || snapshot.structured.findings.length > 0)
  );
}

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
    const row = this.runRow(runId);
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
    return this.detail(this.runRow(runId));
  }

  /**
   * Event channel of a run for the SSE route. Live runs use their channel; terminal runs get a
   * synthesised channel carrying a single terminal event, so `stream` always replays correctly.
   */
  channel(runId: string): RunChannel {
    const existing = this.channels.get(runId);
    if (existing !== undefined) return existing;
    const row = this.runRow(runId);
    const channel = new RunChannel();
    const result = this.parseResult(row.reportJson);
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
    this.scheduleChannelEviction(runId);
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
            this.persistProgress(
              runId,
              JSON.stringify(this.partialResult(digest, snapshot, CHECKPOINT_REASON)),
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
      this.persist(runId, {
        status: "completed",
        verdict: result.report.verdict,
        qualityScore: result.report.qualityScore,
        reportJson: JSON.stringify(persisted),
        diffSummaryJson: JSON.stringify(digest.stats),
        error: null,
        durationMs: Date.now() - startedAt,
      });
      this.persistManifests(runId, result);
      this.scheduleChannelEviction(runId);
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
          : this.partialResult(rescued.digest, rescued.checkpoint, CANCELLED_REASON);
      this.persist(runId, {
        status: "cancelled",
        verdict: null,
        qualityScore: null,
        reportJson: partial === null ? null : JSON.stringify(partial),
        diffSummaryJson: statsJson,
        error: "Run cancelled by user",
        durationMs,
      });
      if (rescued !== null) this.persistManifests(runId, rescued.checkpoint);
      this.scheduleChannelEviction(runId);
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
          ? this.fallbackResult(digest, buildFallbackReport(digest, error))
          : this.partialResult(rescued.digest, rescued.checkpoint, reason);
      this.deps.log.warn(
        { runId, code: error.code, passes: persisted.passes.length },
        "review ended without a synthesised report",
      );
      this.persist(runId, {
        status: "completed",
        verdict: persisted.report.verdict,
        qualityScore: persisted.report.qualityScore,
        reportJson: JSON.stringify(persisted),
        diffSummaryJson: statsJson,
        error: null,
        durationMs,
      });
      if (rescued !== null) this.persistManifests(runId, rescued.checkpoint);
      this.scheduleChannelEviction(runId);
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
        : this.partialResult(
            rescued.digest,
            rescued.checkpoint,
            `Lượt chạy lỗi (${message}) — đây là phần AI đã đọc được trước khi dừng.`,
          );
    this.persist(runId, {
      status: "failed",
      verdict: null,
      qualityScore: null,
      reportJson: partial === null ? null : JSON.stringify(partial),
      diffSummaryJson: statsJson,
      error: message,
      durationMs,
    });
    if (rescued !== null) this.persistManifests(runId, rescued.checkpoint);
    this.scheduleChannelEviction(runId);
    await channel.emit({ type: "failed", error: message });
  }

  /**
   * Persist a mid-run checkpoint. Only `reportJson` is written — the row stays `running` until the
   * run really ends, so status polling and the SSE channel are unaffected. A run that never comes
   * back (process death) keeps this row: `reconcileInterruptedRuns` marks it failed, and the run
   * page renders the partial report from it.
   */
  private persistProgress(runId: string, reportJson: string): void {
    this.deps.db.update(runs).set({ reportJson }).where(eq(runs.id, runId)).run();
  }

  /** Deterministic fallback result — no pass ran, so the report is engine stats plus the reason. */
  private fallbackResult(digest: DigestBundle, fallback: FallbackReport): ReviewRunResult {
    return {
      report: fallback.report,
      passes: [],
      themes: [],
      verification: { read: ZERO_STATS, dig: null, synthesize: ZERO_STATS, issues: [] },
      contextManifest: {
        counts: { changeFacts: 0, linked: 0, contextItems: 0, evidence: 0, evidenceDropped: 0 },
        notes: [],
      },
      surfaces: digest.surfaces,
      engineFindings: digest.findings,
      fallbackReason: fallback.reason,
      degradedReason: null,
    };
  }

  /**
   * Partial result of an unfinished run: the passes and readings that happened are kept verbatim
   * and the report is the honest partial one (readings lifted 1:1, verdict `insufficient_evidence`,
   * `degradedReason` set). `fallbackReason` stays null — a model did run here.
   */
  private partialResult(
    digest: DigestBundle,
    snapshot: PipelineCheckpoint,
    reason: string,
  ): ReviewRunResult {
    const partial = buildPartialReport({ digest, structured: snapshot.structured, reason });
    return {
      report: partial.report,
      passes: [...snapshot.passes],
      themes: [...snapshot.themes],
      verification: {
        read: snapshot.verification.read,
        dig: snapshot.verification.dig,
        synthesize: snapshot.verification.synthesize,
        issues: [...snapshot.verification.issues],
      },
      contextManifest: {
        counts: snapshot.contextManifest.counts,
        notes: [...snapshot.contextManifest.notes],
      },
      surfaces: digest.surfaces,
      engineFindings: digest.findings,
      fallbackReason: null,
      degradedReason: reason,
    };
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

  /** One `context_manifests` row per executed pass — what was sent, the call stats, linker counts. */
  private persistManifests(
    runId: string,
    result: {
      readonly passes: readonly PassMeta[];
      readonly verification: PipelineVerification;
      readonly contextManifest: {
        readonly counts: ReviewContextManifest["counts"];
        readonly notes: readonly string[];
      };
    },
  ): void {
    const sectionsJson = JSON.stringify(result.contextManifest);
    const totalBytes = Buffer.byteLength(sectionsJson, "utf8");
    for (const meta of result.passes) {
      const stats =
        meta.pass === "read"
          ? result.verification.read
          : meta.pass === "dig"
            ? result.verification.dig
            : meta.pass === "synthesize"
              ? result.verification.synthesize
              : null;
      this.deps.db
        .insert(contextManifests)
        .values({
          id: randomUUID(),
          runId,
          turnId: null,
          promptVersion: meta.promptVersion,
          passId: meta.pass,
          sectionsJson,
          totalBytes,
          aiCallJson: JSON.stringify({
            latencyMs: meta.latencyMs,
            salvage: meta.salvage,
            cached: meta.cached,
            ...(meta.unit === undefined ? {} : { unit: meta.unit }),
            ...(meta.chunk === undefined ? {} : { chunk: meta.chunk }),
            ...(meta.chunks === undefined ? {} : { chunks: meta.chunks }),
            ...(meta.round === undefined ? {} : { round: meta.round }),
          }),
          verifiedStatsJson: stats === null ? null : JSON.stringify(stats),
          createdAt: new Date(),
        })
        .run();
    }
  }

  private persist(
    runId: string,
    fields: {
      status: "completed" | "failed" | "cancelled";
      verdict: string | null;
      qualityScore: number | null;
      reportJson: string | null;
      diffSummaryJson: string | null;
      error: string | null;
      durationMs: number;
    },
  ): void {
    this.deps.db
      .update(runs)
      .set({
        status: fields.status,
        verdict: fields.verdict as (typeof runs.$inferInsert)["verdict"],
        qualityScore: fields.qualityScore,
        reportJson: fields.reportJson,
        diffSummaryJson: fields.diffSummaryJson,
        error: fields.error,
        durationMs: fields.durationMs,
        completedAt: new Date(),
      })
      .where(eq(runs.id, runId))
      .run();
  }

  private runRow(runId: string): typeof runs.$inferSelect {
    const row = this.deps.db.select().from(runs).where(eq(runs.id, runId)).get();
    if (row === undefined) {
      throw new AppError(ErrorCodes.notFound, "Lượt review không tồn tại");
    }
    return row;
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
    return { ...this.summary(row), result: this.parseResult(row.reportJson) };
  }

  private parseResult(reportJson: string | null): ReviewRunResult | null {
    if (reportJson === null) return null;
    return JSON.parse(reportJson) as ReviewRunResult;
  }

  /**
   * Schedule channel deletion after TTL to prevent unbounded memory growth while
   * allowing connected clients to finish receiving replay events.
   */
  private scheduleChannelEviction(runId: string): void {
    setTimeout(() => {
      this.channels.delete(runId);
    }, CHANNEL_RETENTION_TTL_MS).unref?.();
  }
}

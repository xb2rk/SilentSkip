import { randomUUID } from "node:crypto";
import {
  AiError,
  buildFallbackReport,
  type PassConfig,
  type PipelineStageEvent,
  runReviewPipeline,
  type WorkflowRunner,
} from "@craftland-qa/ai";
import {
  AppError,
  ErrorCodes,
  type ReviewRunResult,
  type ReviewStreamEvent,
  type RunDetailResponse,
  type StartReviewRequest,
  type VerifyStats,
  WORKTREE_REF,
} from "@craftland-qa/contracts";
import { type AppDatabase, contextManifests, runs } from "@craftland-qa/db";
import { eq } from "drizzle-orm";
import type { Logger } from "pino";
import { loadDigest } from "./digest-input";
import { getProject } from "./projects";

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
 * Live event channel of one run. `emit` never throws on subscriber errors (a client that
 * disconnected must not kill the run); `attach` replays the buffer, then waits for the terminal
 * event, which makes the SSE route correct for both live and already-finished runs.
 */
class RunChannel {
  private readonly events: ReviewStreamEvent[] = [];
  private readonly subscribers = new Set<(event: ReviewStreamEvent) => Promise<void>>();
  private terminal = false;
  private readonly closed: Promise<void>;
  private resolveClosed: () => void = () => {};

  constructor() {
    this.closed = new Promise<void>((resolve) => {
      this.resolveClosed = resolve;
    });
  }

  async emit(event: ReviewStreamEvent): Promise<void> {
    this.events.push(event);
    for (const subscriber of [...this.subscribers]) {
      try {
        await subscriber(event);
      } catch {
        // Subscriber gone (client aborted) — the run must keep going.
      }
    }
    if (event.type !== "stage") {
      this.terminal = true;
      this.subscribers.clear();
      this.resolveClosed();
    }
  }

  /** Replay the buffer to `listener`, then keep delivering until the terminal event. */
  async attach(listener: (event: ReviewStreamEvent) => Promise<void>): Promise<void> {
    for (const event of this.events) await listener(event);
    if (this.terminal) return;
    this.subscribers.add(listener);
    await this.closed;
  }
}

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
      });
    } else if (row.status === "cancelled") {
      void channel.emit({ type: "cancelled" });
    } else if (row.status === "failed") {
      void channel.emit({ type: "failed", error: row.error ?? "run failed" });
    }
    this.channels.set(runId, channel);
    return channel;
  }

  private async execute(runId: string, rootPath: string, input: StartReviewRequest): Promise<void> {
    const channel = this.channels.get(runId);
    const controller = this.controllers.get(runId);
    if (channel === undefined || controller === undefined) return;
    const startedAt = Date.now();
    let digest: Awaited<ReturnType<typeof loadDigest>> | undefined;
    try {
      await channel.emit({ type: "stage", stage: "digest", state: "started" });
      digest = await loadDigest(rootPath, input.baseRef, input.currentRef);
      await channel.emit({ type: "stage", stage: "digest", state: "completed" });
      const result = await runReviewPipeline(
        { runner: this.deps.runner, config: this.deps.config },
        {
          digest,
          ...(input.goal === undefined ? {} : { goal: input.goal }),
          ...(input.lens === undefined ? {} : { lens: input.lens }),
          signal: controller.signal,
          onEvent: (event) => this.relayStage(channel, event),
        },
      );
      const persisted: ReviewRunResult = {
        report: result.report,
        passes: [...result.passes],
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
        fallbackReason: null,
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
      await channel.emit({
        type: "completed",
        verdict: result.report.verdict,
        qualityScore: result.report.qualityScore,
        findings: result.report.findings.length,
        fallbackReason: null,
      });
    } catch (error) {
      await this.failRun(runId, channel, controller, digest, error, startedAt);
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
  ): Promise<void> {
    const durationMs = Date.now() - startedAt;
    const statsJson = digest === undefined ? null : JSON.stringify(digest.stats);
    const cancelled =
      controller.signal.aborted || (error instanceof AiError && error.code === "cancelled");
    if (cancelled) {
      this.persist(runId, {
        status: "cancelled",
        verdict: null,
        qualityScore: null,
        reportJson: null,
        diffSummaryJson: statsJson,
        error: "Run cancelled by user",
        durationMs,
      });
      await channel.emit({ type: "cancelled" });
      return;
    }
    if (error instanceof AiError && digest !== undefined) {
      const fallback = buildFallbackReport(digest, error);
      this.deps.log.warn(
        { runId, code: error.code },
        "review fell back to the deterministic report",
      );
      const persisted: ReviewRunResult = {
        report: fallback.report,
        passes: [],
        verification: { read: ZERO_STATS, dig: null, synthesize: ZERO_STATS, issues: [] },
        contextManifest: {
          counts: { changeFacts: 0, linked: 0, contextItems: 0, evidence: 0, evidenceDropped: 0 },
          notes: [],
        },
        fallbackReason: fallback.reason,
      };
      this.persist(runId, {
        status: "completed",
        verdict: fallback.report.verdict,
        qualityScore: fallback.report.qualityScore,
        reportJson: JSON.stringify(persisted),
        diffSummaryJson: statsJson,
        error: null,
        durationMs,
      });
      await channel.emit({
        type: "completed",
        verdict: fallback.report.verdict,
        qualityScore: fallback.report.qualityScore,
        findings: 0,
        fallbackReason: fallback.reason,
      });
      return;
    }
    const message = error instanceof Error ? error.message : "review run failed";
    this.deps.log.error({ err: error, runId }, "review run failed");
    this.persist(runId, {
      status: "failed",
      verdict: null,
      qualityScore: null,
      reportJson: null,
      diffSummaryJson: statsJson,
      error: message,
      durationMs,
    });
    await channel.emit({ type: "failed", error: message });
  }

  private relayStage(channel: RunChannel, event: PipelineStageEvent): Promise<void> {
    return channel.emit({
      type: "stage",
      stage: event.stage,
      state: event.state,
      ...(event.latencyMs === undefined ? {} : { latencyMs: event.latencyMs }),
      ...(event.salvage === undefined ? {} : { salvage: event.salvage }),
    });
  }

  /** One `context_manifests` row per executed pass — what was sent, the call stats, verifier counts. */
  private persistManifests(
    runId: string,
    result: Awaited<ReturnType<typeof runReviewPipeline>>,
  ): void {
    const sectionsJson = JSON.stringify(result.contextManifest);
    const totalBytes = Buffer.byteLength(sectionsJson, "utf8");
    for (const meta of result.passes) {
      const stats =
        meta.pass === "digest_read"
          ? result.verification.read
          : meta.pass === "dig"
            ? result.verification.dig
            : result.verification.synthesize;
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
          aiCallJson: JSON.stringify({ latencyMs: meta.latencyMs, salvage: meta.salvage }),
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

  private detail(row: typeof runs.$inferSelect): RunDetailResponse {
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
      result: this.parseResult(row.reportJson),
    };
  }

  private parseResult(reportJson: string | null): ReviewRunResult | null {
    if (reportJson === null) return null;
    return JSON.parse(reportJson) as ReviewRunResult;
  }
}

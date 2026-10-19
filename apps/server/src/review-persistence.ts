import { randomUUID } from "node:crypto";
import type { PassMeta, PipelineVerification } from "@silentskip/ai";
import {
  AppError,
  ErrorCodes,
  type ReviewContextManifest,
  type ReviewRunResult,
  ReviewRunResultSchema,
} from "@silentskip/contracts";
import { type AppDatabase, contextManifests, runs } from "@silentskip/db";
import { eq, inArray } from "drizzle-orm";
import type { Logger } from "pino";

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

/** One run row by id — throws NOT_FOUND for unknown ids. */
export function readRunRow(db: AppDatabase, runId: string): typeof runs.$inferSelect {
  const row = db.select().from(runs).where(eq(runs.id, runId)).get();
  if (row === undefined) {
    throw new AppError(ErrorCodes.notFound, "Lượt review không tồn tại");
  }
  return row;
}

/**
 * Stored reports are read back through the contract: a row written by an older build (or a
 * corrupted one) must not crash the detail route with a blind cast.
 */
export function parseStoredResult(
  log: Logger,
  runId: string,
  reportJson: string | null,
): ReviewRunResult | null {
  if (reportJson === null) return null;
  try {
    const parsed = ReviewRunResultSchema.safeParse(JSON.parse(reportJson));
    if (parsed.success) return parsed.data;
    log.warn(
      { runId, issues: parsed.error.issues.slice(0, 3) },
      "stored run report failed validation",
    );
  } catch (error) {
    log.warn({ runId, err: error }, "stored run report is not valid JSON");
  }
  return null;
}

/**
 * Persist a mid-run checkpoint. Only `reportJson` is written — the row stays `running` until the
 * run really ends, so status polling and the SSE channel are unaffected. A run that never comes
 * back (process death) keeps this row: `reconcileInterruptedRuns` marks it failed, and the run
 * page renders the partial report from it.
 */
export function persistProgress(db: AppDatabase, runId: string, reportJson: string): void {
  db.update(runs).set({ reportJson }).where(eq(runs.id, runId)).run();
}

/** Terminal fields of a run row, as written by every outcome path. */
export interface RunOutcomeFields {
  status: "completed" | "failed" | "cancelled";
  verdict: string | null;
  qualityScore: number | null;
  reportJson: string | null;
  diffSummaryJson: string | null;
  error: string | null;
  durationMs: number;
}

/** Write the terminal state of a run. */
export function persistRunOutcome(db: AppDatabase, runId: string, fields: RunOutcomeFields): void {
  db.update(runs)
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

/** Shape of what `persistManifests` records — satisfied by a full result or a checkpoint. */
interface ManifestSource {
  readonly passes: readonly PassMeta[];
  readonly verification: PipelineVerification;
  readonly contextManifest: {
    readonly counts: ReviewContextManifest["counts"];
    readonly notes: readonly string[];
  };
}

/** One `context_manifests` row per executed pass — what was sent, the call stats, linker counts. */
export function persistManifests(db: AppDatabase, runId: string, result: ManifestSource): void {
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
    db.insert(contextManifests)
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

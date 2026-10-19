import { buildPartialReport, type FallbackReport, type PipelineCheckpoint } from "@silentskip/ai";
import type { DigestBundle, ReviewRunResult, VerifyStats } from "@silentskip/contracts";

/** Zeroed verifier stats for fallback results — no pass ran, nothing was verified. */
export const ZERO_STATS: VerifyStats = {
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

/** Reason recorded on a mid-run checkpoint — also what a server restart leaves behind. */
export const CHECKPOINT_REASON =
  "Lượt chạy chưa tổng hợp xong — đây là phần AI đã đọc được trước khi dừng.";

/** Reason recorded when the user cancels a run that had already produced readings. */
export const CANCELLED_REASON = "Đã huỷ lượt chạy — đây là phần AI đã đọc được trước khi huỷ.";

/**
 * A checkpoint is only worth rescuing when it carries work the user would otherwise lose: at
 * least one finished pass, or at least one verified reading. A checkpoint from a run whose very
 * first call failed has nothing to keep — the deterministic fallback tells that story better.
 */
export function hasCheckpointWork(
  snapshot: PipelineCheckpoint | undefined,
): snapshot is PipelineCheckpoint {
  return (
    snapshot !== undefined &&
    (snapshot.passes.length > 0 || snapshot.structured.findings.length > 0)
  );
}

/** Deterministic fallback result — no pass ran, so the report is engine stats plus the reason. */
export function fallbackResult(digest: DigestBundle, fallback: FallbackReport): ReviewRunResult {
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
export function partialResult(
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

import { AiError } from "../errors.js";
import { runInseaWorkflow } from "./client.js";
import type { InseaRunResult } from "./types.js";

/** Configuration slice the canary needs — deliberately minimal so Settings can pass it through. */
export interface CanaryConfig {
  readonly workflowUrl: string | null;
  readonly apiKey: string | null;
  readonly timeoutMs?: number;
}

/** Outcome of a canary run: transport-level success plus whether the model honoured the JSON contract. */
export interface CanaryResult {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly salvage: InseaRunResult["salvage"];
  readonly output: Record<string, unknown>;
}

const CANARY_PROMPT = `Return STRICT JSON only, no prose:
{"ok": true, "purpose": "canary"}`;

const CANARY_MANIFEST = JSON.stringify({
  version: "1.0.0",
  stage: "canary",
  goal: "Connectivity probe from SilentSkip",
  files: [{ uploadName: "canary.txt", relativePath: "canary.txt", kind: "other", byteSize: 6 }],
});

/**
 * Round-trip probe of the configured workflow.
 *
 * Sends a minimal prompt whose only correct answer is `{"ok": true}` plus one tiny attachment,
 * so it exercises the full multipart path, auth, envelope unwrap and JSON salvage. The result
 * distinguishes "endpoint answered but drifted" (`ok: false` — inspect `output`) from transport
 * failures, which throw `AiError`.
 */
export async function canaryProbe(
  config: CanaryConfig,
  signal?: AbortSignal,
): Promise<CanaryResult> {
  const result = await runInseaWorkflow({
    url: config.workflowUrl ?? "",
    apiKey: config.apiKey ?? "",
    prompt: CANARY_PROMPT,
    manifestJson: CANARY_MANIFEST,
    attachments: [{ uploadName: "canary.txt", content: "canary", mimeType: "text/plain" }],
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(signal === undefined ? {} : { signal }),
  });
  return {
    ok: result.output.ok === true,
    latencyMs: result.latencyMs,
    salvage: result.salvage,
    output: result.output,
  };
}

/** One call inside a parallel batch — never throws, so a batch always reports every slot. */
export interface CanaryBatchEntry {
  readonly ok: boolean;
  readonly latencyMs: number;
  readonly salvage: InseaRunResult["salvage"] | null;
  readonly error: { readonly code: string; readonly message: string } | null;
}

/** Outcome of a parallel canary: does the endpoint actually serve concurrent calls? */
export interface CanaryBatchResult {
  readonly requested: number;
  readonly succeeded: number;
  readonly failed: number;
  /** Wall time of the whole batch: compare with `totalLatencyMs` to read the real speedup. */
  readonly wallMs: number;
  readonly totalLatencyMs: number;
  readonly entries: readonly CanaryBatchEntry[];
}

/**
 * Fire `count` probes **at the same time** and report per-slot outcomes.
 *
 * This answers "does the endpoint accept simultaneous calls at all?" — a single probe cannot. It
 * cannot answer "is overlapping worth it?": a canary payload is ~200 bytes, and on real payloads the
 * workflow queues, so latency inflates and wall time does not improve (measured: a 72-file run took
 * 1070 s at K=1 and 1152 s at K=3). Use `payload:probe` for that question. Failures are reported per
 * slot instead of thrown, so "3 parallel calls, one 429" is visible rather than fatal.
 */
export async function canaryParallelProbe(
  config: CanaryConfig,
  count: number,
  signal?: AbortSignal,
): Promise<CanaryBatchResult> {
  const startedAt = performance.now();
  const settled = await Promise.allSettled(
    Array.from({ length: count }, () => canaryProbe(config, signal)),
  );
  const wallMs = Math.round(performance.now() - startedAt);
  const entries: CanaryBatchEntry[] = settled.map((outcome) => {
    if (outcome.status === "fulfilled") {
      return {
        ok: outcome.value.ok,
        latencyMs: outcome.value.latencyMs,
        salvage: outcome.value.salvage,
        error: null,
      };
    }
    const error = outcome.reason;
    return {
      ok: false,
      latencyMs: 0,
      salvage: null,
      error:
        error instanceof AiError
          ? { code: error.code, message: error.message }
          : { code: "unknown", message: String(error) },
    };
  });
  return {
    requested: count,
    succeeded: entries.filter((entry) => entry.ok).length,
    failed: entries.filter((entry) => !entry.ok).length,
    wallMs,
    totalLatencyMs: entries.reduce((sum, entry) => sum + entry.latencyMs, 0),
    entries,
  };
}

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

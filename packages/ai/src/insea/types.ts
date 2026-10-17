/**
 * Request/response shapes of one stateless Insea workflow run (multipart protocol v1).
 *
 * Protocol (the endpoint the previous QA generation used — Insea project 25537):
 * - `Prompt`   — natural-language instructions for the pass (stage)
 * - `Manifest` — JSON string describing goal, refs, stage and attached files
 * - `DataList` — repeated text attachments; the endpoint requires at least one
 *
 * The service is stateless and single-shot: every call carries everything the model sees and
 * nothing is remembered server-side. That is why our pipeline rebuilds context per message and
 * records what was sent in a manifest.
 */

/** One text attachment in the multipart `DataList`. `uploadName` is how the manifest refers to it. */
export interface InseaAttachment {
  readonly uploadName: string;
  readonly content: string;
  readonly mimeType: string;
}

/** Input of one workflow run. */
export interface InseaRunRequest {
  readonly url: string;
  readonly apiKey: string;
  readonly prompt: string;
  readonly manifestJson: string;
  readonly attachments: readonly InseaAttachment[];
  /** Overrides the client default (180s) — server config passes `AI_WORKFLOW_TIMEOUT_MS` through. */
  readonly timeoutMs?: number;
  /** External cancellation (user pressed cancel). */
  readonly signal?: AbortSignal;
}

/** How the workflow result text was recovered from the envelope. */
export type InseaSalvage =
  | "clean" // `outputs.result` was valid JSON as-is
  | "stripped" // reasoning tags (` thinking…`) were removed first
  | "fence" // JSON was extracted from a markdown code fence
  | "braces" // JSON was extracted as the outermost `{…}` span
  | "text-fallback"; // no JSON anywhere — raw text kept under `executiveSummary`

/** Result of one workflow run. `output` is always a JSON object — the salvage ladder guarantees it. */
export interface InseaRunResult {
  readonly output: Record<string, unknown>;
  /** The raw `outputs.result` string exactly as returned (for debugging and run records). */
  readonly rawResult: string;
  readonly salvage: InseaSalvage;
  readonly latencyMs: number;
}

/**
 * Error model of the AI layer.
 *
 * This package never throws `AppError` — that is the server's HTTP-facing error. Failures here
 * carry a stable `AiErrorCode` so callers (run pipeline, routes, SSE) can map them to HTTP
 * codes, events and honest user-facing messages without string matching.
 */

/** Stable failure classes of AI-layer operations. */
export type AiErrorCode =
  | "not-configured" // URL or API key missing — the AI layer is optional by design
  | "http-error" // the workflow endpoint answered with a non-2xx status (or a non-JSON body)
  | "timeout" // the per-request timeout elapsed
  | "cancelled" // the caller aborted (user cancel)
  | "network"; // transport failure before any usable HTTP response

/** Error thrown by AI-layer operations; `details` carries a short, safe diagnostic preview. */
export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly status: number | undefined;
  readonly details: string | undefined;

  constructor(
    code: AiErrorCode,
    message: string,
    options: { status?: number; details?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AiError";
    this.code = code;
    this.status = options.status;
    this.details = options.details;
  }
}

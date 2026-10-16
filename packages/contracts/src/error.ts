import { z } from "zod";

/**
 * Error envelope shared by the whole stack. Every non-2xx API response carries this shape,
 * so the web client can render consistent error states without guessing per-endpoint.
 */

/** Stable machine-readable error codes. */
export const ErrorCodes = {
  badRequest: "BAD_REQUEST",
  notFound: "NOT_FOUND",
  conflict: "CONFLICT",
  pathNotAllowed: "PATH_NOT_ALLOWED",
  notAProject: "NOT_A_PROJECT",
  notAGitRepo: "NOT_A_GIT_REPO",
  unknownRef: "UNKNOWN_REF",
  gitFailed: "GIT_FAILED",
  internal: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PATH_NOT_ALLOWED: 403,
  NOT_A_PROJECT: 422,
  NOT_A_GIT_REPO: 422,
  UNKNOWN_REF: 400,
  GIT_FAILED: 500,
  INTERNAL: 500,
};

export interface AppErrorOptions {
  /** Override the default HTTP status derived from the code. */
  readonly status?: number;
  /** Extra machine-readable context (never rendered raw to designers). */
  readonly details?: unknown;
  /** Original error, preserved for logging. */
  readonly cause?: unknown;
}

/** Error type thrown by application code and serialized into the API envelope. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.status = options.status ?? STATUS_BY_CODE[code];
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }

  /** Serialize into the wire envelope shape. */
  toEnvelope(): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

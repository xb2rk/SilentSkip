import { homedir } from "node:os";
import { join } from "node:path";
import { AppError, ErrorCodes } from "@silentskip/contracts";

/**
 * Server configuration, resolved once at boot from environment variables with safe,
 * local-first defaults. Pure function of `env` — keeps boot testable without touching
 * the real process environment.
 */

/** Boot configuration derived once from the environment; passed explicitly so runtime code never reads `process.env`. */
export interface ServerConfig {
  readonly nodeEnv: string;
  readonly host: string;
  readonly port: number;
  readonly logLevel: string;
  readonly sqlitePath: string;
  readonly ai: AiWorkflowConfig;
}

/**
 * AI workflow configuration. A `null` URL or key means the AI pipeline is not configured:
 * the app still works — runs fall back to the deterministic path and say so.
 */
export interface AiWorkflowConfig {
  readonly workflowUrl: string | null;
  readonly apiKey: string | null;
  /** Per-request timeout; Insea runs can be slow, so the default is deliberately generous. */
  readonly timeoutMs: number;
  /**
   * Reuse workflow answers for byte-identical calls (`AI_PASS_CACHE`, on by default). Rerunning
   * the same comparison then replays the passes it already paid for, and a run that was
   * interrupted resumes from where its calls stopped instead of from zero.
   */
  readonly passCache: boolean;
  /**
   * Max `read` calls in flight (`AI_READ_CONCURRENCY`, default 1). Reading units are independent and
   * outcomes fold in unit order, so this cannot change the report — but measurement on a real
   * 72-file run found no wall-time gain above 1: the workflow queues overlapping calls, and each call
   * inflated up to 8x (1070 s at K=1 vs 1152 s at K=3). Keep it at 1 unless a new endpoint is
   * measured with real payloads via `pnpm --filter @silentskip/ai canary -- --parallel <n>`.
   */
  readonly readConcurrency: number;
}

const DEFAULT_PORT = 3000;

/** Load and validate configuration from `env`; throws on invalid values instead of limping along. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  return {
    nodeEnv,
    host: env.HOST ?? "127.0.0.1",
    port: parsePort(env.PORT),
    logLevel: env.LOG_LEVEL ?? (nodeEnv === "production" ? "info" : "debug"),
    sqlitePath: env.SQLITE_PATH ?? defaultSqlitePath(env),
    ai: {
      workflowUrl: emptyToNull(env.AI_WORKFLOW_URL),
      apiKey: emptyToNull(env.AI_WORKFLOW_API_KEY),
      timeoutMs: parseTimeoutMs(env.AI_WORKFLOW_TIMEOUT_MS),
      passCache: parseFlag(env.AI_PASS_CACHE, true),
      readConcurrency: parseConcurrency(env.AI_READ_CONCURRENCY),
    },
  };
}

/** Boolean env flag: unset or blank keeps the default; `0/false/off/no` (any case) turns it off. */
function parseFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  return !["0", "false", "off", "no"].includes(raw.trim().toLowerCase());
}

/** Treat blank env values as "not configured" so `.env` placeholders cannot half-configure the AI layer. */
function emptyToNull(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === "") return null;
  return raw.trim();
}

const DEFAULT_AI_TIMEOUT_MS = 180_000;

function parseTimeoutMs(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_AI_TIMEOUT_MS;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1_000) {
    throw new AppError(ErrorCodes.badRequest, `Invalid AI_WORKFLOW_TIMEOUT_MS value: ${raw}`);
  }
  return value;
}

const DEFAULT_AI_READ_CONCURRENCY = 1;
/** Upper bound so a mistyped value cannot flood the workflow endpoint. */
const MAX_AI_READ_CONCURRENCY = 16;

/**
 * Reading concurrency. Defaults to 1 because overlapping buys nothing on this endpoint: a real
 * 72-file run took 1070 s at K=1 and 1152 s (and more AI time) at K=3, and calls fired together cost
 * 2-8x their solo latency. The toy canary only shows the endpoint *accepts* concurrency, so raise
 * this only after measuring real payloads.
 */
function parseConcurrency(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_AI_READ_CONCURRENCY;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > MAX_AI_READ_CONCURRENCY) {
    throw new AppError(ErrorCodes.badRequest, `Invalid AI_READ_CONCURRENCY value: ${raw}`);
  }
  return value;
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === "") {
    return DEFAULT_PORT;
  }
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new AppError(ErrorCodes.badRequest, `Invalid PORT value: ${raw}`);
  }
  return port;
}

/** Default DB location mirrors familiar per-user app data conventions. */
function defaultSqlitePath(env: NodeJS.ProcessEnv): string {
  const localAppData = env.LOCALAPPDATA;
  if (localAppData !== undefined && localAppData !== "") {
    return join(localAppData, "SilentSkip", "data.sqlite");
  }
  return join(homedir(), ".silentskip", "data.sqlite");
}

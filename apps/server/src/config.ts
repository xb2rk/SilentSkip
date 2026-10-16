import { homedir } from "node:os";
import { join } from "node:path";
import { AppError, ErrorCodes } from "@craftland-qa/contracts";

/**
 * Server configuration, resolved once at boot from environment variables with safe,
 * local-first defaults. Pure function of `env` — keeps boot testable without touching
 * the real process environment.
 */

export interface ServerConfig {
  readonly nodeEnv: string;
  readonly host: string;
  readonly port: number;
  readonly logLevel: string;
  readonly sqlitePath: string;
  /** Seed for allowed roots (env `ANALYZED_ROOTS`, `;`/`,`-separated) until Settings owns them. */
  readonly analyzedRoots: readonly string[];
}

const DEFAULT_PORT = 3000;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  return {
    nodeEnv,
    host: env.HOST ?? "127.0.0.1",
    port: parsePort(env.PORT),
    logLevel: env.LOG_LEVEL ?? (nodeEnv === "production" ? "info" : "debug"),
    sqlitePath: env.SQLITE_PATH ?? defaultSqlitePath(env),
    analyzedRoots: parseAnalyzedRoots(env.ANALYZED_ROOTS),
  };
}

/** `ANALYZED_ROOTS` accepts `;`- or `,`-separated absolute folder paths. */
function parseAnalyzedRoots(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") {
    return [];
  }
  return raw
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
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
    return join(localAppData, "CraftlandQA", "data.sqlite");
  }
  return join(homedir(), ".craftland-qa", "data.sqlite");
}

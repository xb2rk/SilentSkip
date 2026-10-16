import { homedir } from "node:os";
import { join } from "node:path";
import { AppError, ErrorCodes } from "@craftland-qa/contracts";

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
  };
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

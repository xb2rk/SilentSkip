import { type Logger, pino } from "pino";
import type { ServerConfig } from "./config";

/**
 * Structured logger factory. Development output is human-readable (pino-pretty);
 * production stays raw JSON so any log pipeline can parse it. Tests construct
 * `pino({ level: "silent" })` directly instead.
 */
export function createLogger(config: Pick<ServerConfig, "logLevel" | "nodeEnv">): Logger {
  const usePrettyTransport = config.nodeEnv !== "production";
  return pino({
    level: config.logLevel,
    ...(usePrettyTransport
      ? {
          transport: {
            target: "pino-pretty",
            options: { colorize: true, translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname" },
          },
        }
      : {}),
  });
}

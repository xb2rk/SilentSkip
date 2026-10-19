import "./env";
import { serve } from "@hono/node-server";
import { PRODUCT_VERSION } from "@silentskip/contracts";
import { migrateDatabase, openDatabase } from "@silentskip/db";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createLogger } from "./logger";
import { createSqlitePassCache } from "./pass-cache";
import { reconcileInterruptedRuns } from "./reviews";

const config = loadConfig();
const log = createLogger(config);

log.info({ version: PRODUCT_VERSION, env: config.nodeEnv }, "starting SilentSkip server");

const db = openDatabase(config.sqlitePath);
migrateDatabase(db);
const interrupted = reconcileInterruptedRuns(db);
if (interrupted > 0) {
  log.warn({ count: interrupted }, "marked interrupted review runs as failed");
}
log.info({ sqlitePath: config.sqlitePath, passCache: config.ai.passCache }, "database ready");

const passCache = config.ai.passCache ? createSqlitePassCache(db) : undefined;
const app = createApp({
  db,
  log,
  ai: {
    config: config.ai,
    ...(passCache === undefined ? {} : { cache: passCache }),
  },
});

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  log.info({ url: `http://${config.host}:${info.port}` }, "server listening");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    log.info({ signal }, "shutting down");
    server.close(() => process.exit(0));
  });
}

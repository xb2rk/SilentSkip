import "./env";
import { PRODUCT_VERSION } from "@craftland-qa/contracts";
import { migrateDatabase, openDatabase } from "@craftland-qa/db";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createLogger } from "./logger";

const config = loadConfig();
const log = createLogger(config);

log.info({ version: PRODUCT_VERSION, env: config.nodeEnv }, "starting Craftland QA server");

const db = openDatabase(config.sqlitePath);
migrateDatabase(db);
log.info({ sqlitePath: config.sqlitePath }, "database ready");

const app = createApp({ db, log, ai: { config: config.ai } });

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  log.info({ url: `http://${config.host}:${info.port}` }, "server listening");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    log.info({ signal }, "shutting down");
    server.close(() => process.exit(0));
  });
}

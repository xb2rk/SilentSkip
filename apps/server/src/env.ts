import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Side-effect module: load `.env` files into `process.env` before configuration is read.
 *
 * Load order (later file wins for keys it defines): repo-root `.env`, then `apps/server/.env`.
 * Uses Node's built-in loader (`process.loadEnvFile`) — no dotenv dependency, no extra
 * dependency surface in the packaged app. Import this module before reading config.
 */
for (const candidate of [resolve(process.cwd(), "../../.env"), resolve(process.cwd(), ".env")]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
  }
}

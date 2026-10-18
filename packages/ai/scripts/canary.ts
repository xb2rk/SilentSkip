/**
 * Real round-trip canary: `pnpm --filter @silentskip/ai canary`.
 *
 * Loads the repo-root `.env` (the same file the server reads), probes the configured Insea
 * workflow and prints the outcome as JSON. Exit code 1 when unconfigured, unreachable, or when
 * the model did not honour the JSON contract — so manual checks and CI can gate on it.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { AiError, canaryProbe } from "../src/index.js";

const envPath = resolve(process.cwd(), "../../.env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const workflowUrl = process.env.AI_WORKFLOW_URL ?? null;
const apiKey = process.env.AI_WORKFLOW_API_KEY ?? null;
const timeoutRaw = process.env.AI_WORKFLOW_TIMEOUT_MS;
const parsedTimeout = timeoutRaw === undefined ? Number.NaN : Number.parseInt(timeoutRaw, 10);
const timeoutMs = Number.isFinite(parsedTimeout) ? parsedTimeout : undefined;

if (workflowUrl === null || apiKey === null) {
  console.error(
    "canary: AI_WORKFLOW_URL / AI_WORKFLOW_API_KEY are not set (checked repo-root .env)",
  );
  process.exit(1);
}

try {
  const result = await canaryProbe(
    timeoutMs === undefined ? { workflowUrl, apiKey } : { workflowUrl, apiKey, timeoutMs },
  );
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        latencyMs: result.latencyMs,
        salvage: result.salvage,
        output: result.output,
      },
      null,
      2,
    ),
  );
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  if (error instanceof AiError) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          code: error.code,
          status: error.status,
          message: error.message,
          details: error.details,
        },
        null,
        2,
      ),
    );
  } else {
    console.error(error);
  }
  process.exit(1);
}

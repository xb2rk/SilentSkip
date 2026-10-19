/**
 * Real round-trip canary: `pnpm --filter @silentskip/ai canary [--parallel <n>]`.
 *
 * Loads the repo-root `.env` (the same file the server reads), probes the configured Insea
 * workflow and prints the outcome as JSON. Exit code 1 when unconfigured, unreachable, or when
 * the model did not honour the JSON contract — so manual checks and CI can gate on it.
 *
 * `--parallel <n>` fires `n` probes at the same time and reports per-slot latency/errors plus the
 * batch wall time. That only shows whether the endpoint **accepts** simultaneous calls: the canary
 * payload is ~200 bytes, so it says nothing about real cost. Measure real payloads with
 * `payload:probe` before raising `AI_READ_CONCURRENCY` (which defaults to 1 for that reason).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { AiError, canaryParallelProbe, canaryProbe } from "../src/index.js";

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

const parallel = parseParallel(process.argv.slice(2));
if (parallel === null) {
  console.error(
    "usage: canary [--parallel <n>]  (n between 1 and 16; fires n simultaneous probes)",
  );
  process.exit(2);
}

const probeConfig =
  timeoutMs === undefined ? { workflowUrl, apiKey } : { workflowUrl, apiKey, timeoutMs };

try {
  if (parallel > 1) {
    const batch = await canaryParallelProbe(probeConfig, parallel);
    console.log(
      JSON.stringify(
        {
          ...batch,
          speedup:
            batch.totalLatencyMs === 0
              ? null
              : Number((batch.totalLatencyMs / batch.wallMs).toFixed(2)),
        },
        null,
        2,
      ),
    );
    process.exit(batch.failed === 0 ? 0 : 1);
  }
  const result = await canaryProbe(probeConfig);
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

/** `--parallel <n>` / `--parallel=<n>`; `null` when the value is not a usable count. */
function parseParallel(argv: readonly string[]): number | null {
  const inline = argv.find((arg) => arg.startsWith("--parallel="));
  const raw =
    inline !== undefined
      ? inline.slice("--parallel=".length)
      : argv.includes("--parallel")
        ? (argv[argv.indexOf("--parallel") + 1] ?? "")
        : "1";
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 16) return null;
  return value;
}

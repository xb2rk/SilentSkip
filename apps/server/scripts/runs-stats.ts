/**
 * Cost report of recent review runs: `pnpm --filter @silentskip/server runs:stats`.
 *
 * Reads the persisted run results straight from SQLite and prints, per run, what every pass cost
 * (calls, sum/avg/max latency, cache hits) and how many bytes it sent. The reading wall time and the
 * speedup it bought come from the per-call span recorded on each pass, so comparing two
 * configurations (chunk sizes, `AI_READ_CONCURRENCY`) is one command instead of a manual dig
 * through the database.
 *
 * Options: `--last <n>` (default 8), `--db <path>` (defaults to the server's `SQLITE_PATH`),
 * `--sections` (also print which attachments dominate a pass's payload).
 */
import "../src/env.js";
import { existsSync } from "node:fs";
import {
  type ReviewPassMeta,
  type ReviewRunResult,
  ReviewRunResultSchema,
} from "@silentskip/contracts";
import { openDatabase, runs } from "@silentskip/db";
import { desc } from "drizzle-orm";
import { loadConfig } from "../src/config.js";

interface Options {
  readonly last: number;
  readonly db: string | null;
  readonly sections: boolean;
}

/** One pass's totals across the calls of a run, in first-seen order. */
interface PassStats {
  readonly pass: string;
  calls: number;
  cached: number;
  sumMs: number;
  maxMs: number;
  bytes: number;
  /** Earliest start / latest finish over live calls, for wall time; null when unknown. */
  startedAt: number | null;
  finishedAt: number | null;
  /** Bytes per payload section, aggregated across the pass's calls. */
  readonly sections: Map<string, number>;
}

const options = parseArgs(process.argv.slice(2));
if (options === null) {
  console.error("usage: runs:stats [--last <n>] [--db <path>] [--sections]");
  process.exit(2);
}

const config = loadConfig();
const dbPath = options.db ?? config.sqlitePath;
if (!existsSync(dbPath)) {
  console.error(`runs:stats: no database at ${dbPath} (pass --db <path>)`);
  process.exit(1);
}

const db = openDatabase(dbPath);
const rows = db.select().from(runs).orderBy(desc(runs.createdAt)).limit(options.last).all();
if (rows.length === 0) {
  console.log(`runs:stats: no runs in ${dbPath}`);
  process.exit(0);
}

console.log(`# ${dbPath}`);
for (const row of rows) {
  printRun(row);
}

function printRun(row: typeof runs.$inferSelect): void {
  const head = [
    row.id.slice(0, 8),
    formatStamp(row.createdAt),
    row.status,
    row.verdict === null ? null : `verdict=${row.verdict}`,
    row.qualityScore === null ? null : `${row.qualityScore}/100`,
    row.durationMs === null ? null : `wall=${formatMs(row.durationMs)}`,
  ]
    .filter((part): part is string => part !== null)
    .join("  ");

  const result = parseResult(row.reportJson);
  if (result === null) {
    console.log(`${head}  (no result recorded)`);
    return;
  }

  const cached = result.passes.filter((meta) => meta.cached).length;
  const aiMs = result.passes.reduce((sum, meta) => sum + meta.latencyMs, 0);
  console.log(`${head}  ${result.passes.length} calls (${cached} cached)  ai=${formatMs(aiMs)}`);
  if (result.degradedReason !== null) console.log(`  degraded: ${result.degradedReason}`);
  if (result.fallbackReason !== null) console.log(`  fallback: ${result.fallbackReason}`);
  if (result.passes.length === 0) {
    console.log("  (no pass ran: fallback or degraded before the first call)");
    return;
  }

  console.log(
    `  ${left("pass", 14)}${right("calls", 6)}${right("cache", 6)}${right("sum", 11)}${right("avg", 11)}${right("max", 11)}${right("payload", 11)}${right("wall", 11)}${right("speed", 8)}`,
  );
  for (const stats of collect(result.passes)) {
    const live = stats.calls - stats.cached;
    const wallMs =
      live >= 2 && stats.startedAt !== null && stats.finishedAt !== null
        ? stats.finishedAt - stats.startedAt
        : null;
    const speed = wallMs === null || wallMs === 0 ? null : stats.sumMs / wallMs;
    const line = [
      left(stats.pass, 14),
      right(String(stats.calls), 6),
      right(String(stats.cached), 6),
      right(formatMs(stats.sumMs), 11),
      right(formatMs(Math.round(stats.sumMs / stats.calls)), 11),
      right(formatMs(stats.maxMs), 11),
      right(formatBytes(stats.bytes), 11),
      right(wallMs === null ? "-" : formatMs(wallMs), 11),
      right(speed === null ? "-" : `${speed.toFixed(2)}x`, 8),
    ].join("");
    console.log(`  ${line}`);
    if (options?.sections === true && stats.sections.size > 0) {
      const top = [...stats.sections.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .slice(0, 5)
        .map(([name, bytes]) => `${name} ${formatBytes(bytes)}`)
        .join(" · ");
      console.log(`  ${left(`  ${stats.pass} sections`, 14)}${top}`);
    }
  }
}

/** Fold a run's pass log into one row per pass, preserving first-seen order. */
function collect(passes: readonly ReviewPassMeta[]): readonly PassStats[] {
  const byPass = new Map<string, PassStats>();
  for (const meta of passes) {
    const stats = byPass.get(meta.pass) ?? {
      pass: meta.pass,
      calls: 0,
      cached: 0,
      sumMs: 0,
      maxMs: 0,
      bytes: 0,
      startedAt: null,
      finishedAt: null,
      sections: new Map<string, number>(),
    };
    stats.calls += 1;
    stats.sumMs += meta.latencyMs;
    stats.maxMs = Math.max(stats.maxMs, meta.latencyMs);
    stats.bytes += meta.payloadBytes;
    if (meta.cached) {
      stats.cached += 1;
    } else if (meta.startedAt !== null && meta.finishedAt !== null) {
      stats.startedAt = Math.min(stats.startedAt ?? meta.startedAt, meta.startedAt);
      stats.finishedAt = Math.max(stats.finishedAt ?? meta.finishedAt, meta.finishedAt);
    }
    for (const section of meta.payloadSections) {
      stats.sections.set(section.name, (stats.sections.get(section.name) ?? 0) + section.bytes);
    }
    byPass.set(meta.pass, stats);
  }
  return [...byPass.values()];
}

/** The persisted result, or null when the row predates a compatible schema. */
function parseResult(json: string | null): ReviewRunResult | null {
  if (json === null) return null;
  try {
    const parsed = ReviewRunResultSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function parseArgs(argv: readonly string[]): Options | null {
  let last = 8;
  let db: string | null = null;
  let sections = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--sections") {
      sections = true;
      continue;
    }
    if (arg === "--last") {
      const value = Number.parseInt(argv[index + 1] ?? "", 10);
      if (!Number.isInteger(value) || value < 1) return null;
      last = value;
      index += 1;
      continue;
    }
    if (arg === "--db") {
      const value = argv[index + 1] ?? "";
      if (value === "") return null;
      db = value;
      index += 1;
      continue;
    }
    return null;
  }
  return { last, db, sections };
}

/** "12m05.3s", "48.2s" or "900ms" — the same scale however long the call took. */
function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${(seconds % 60).toFixed(1).padStart(4, "0")}s`;
}

/** "512 B", "18.4 KB", "1.75 MB" — binary units, same rule as the web UI. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatStamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function left(value: string, width: number): string {
  return value.padEnd(width);
}

function right(value: string, width: number): string {
  return value.padStart(width);
}

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";

/**
 * SQLite access layer built on Node's built-in `node:sqlite` (no native dependencies —
 * keeps dev setup and future ZIP packaging free of compiled binaries) and Drizzle ORM.
 *
 * `openDatabase` is sync by design: the engine treats the DB as local, single-process
 * state. Async is reserved for the HTTP layer above it.
 */

/** Concrete Drizzle handle type bound to the SilentSkip schema. */
export type AppDatabase = ReturnType<typeof createDatabase>;

function createDatabase(connectionPath: string) {
  const sqlite = new DatabaseSync(connectionPath);
  if (connectionPath !== ":memory:") {
    // WAL keeps writes crash-safe and lets future read paths (SSE renderers) coexist.
    sqlite.exec("PRAGMA journal_mode = WAL");
  }
  // NOTE: drizzle-orm 1.0's sqlite config intentionally omits `schema` (tables are passed
  // explicitly to query builders). Relational queries will follow 1.0's relations config
  // when E2 needs them.
  return drizzle({ client: sqlite });
}

/**
 * Open (creating parent directories if needed) the SQLite database at `dbPath`.
 * Pass `":memory:"` for tests.
 */
export function openDatabase(dbPath: string): AppDatabase {
  if (dbPath === ":memory:") {
    return createDatabase(":memory:");
  }
  const absolutePath = resolve(dbPath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  return createDatabase(absolutePath);
}

/** Absolute path of the committed drizzle migrations folder (resolved next to src/). */
export function resolveMigrationsFolder(): string {
  return fileURLToPath(new URL("../drizzle", import.meta.url));
}

/**
 * Apply committed migrations (idempotent; safe to run at every server boot).
 * Throws on failure — a half-migrated database must never be used silently.
 */
export function migrateDatabase(db: AppDatabase): void {
  const failure = migrate(db, { migrationsFolder: resolveMigrationsFolder() });
  if (failure !== undefined) {
    throw new Error(`Database migration failed: ${JSON.stringify(failure)}`);
  }
}

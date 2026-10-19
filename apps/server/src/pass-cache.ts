import type { CachedPassCall, PassCache } from "@silentskip/ai";
import { type AppDatabase, passCache } from "@silentskip/db";
import { eq } from "drizzle-orm";

/**
 * SQLite-backed pass cache (Phase 3): the server's implementation of the AI layer's `PassCache`
 * port, one row per byte-identical workflow call.
 *
 * Sync `node:sqlite` behind the async port — the same deliberate trade as every other database
 * access in this app (decision #23). Writes use `onConflictDoNothing`, so for identical inputs
 * the first stored answer wins and a rerun replays exactly what the original run saw.
 */
export function createSqlitePassCache(db: AppDatabase): PassCache {
  return {
    async get(key: string): Promise<CachedPassCall | undefined> {
      const row = db.select().from(passCache).where(eq(passCache.key, key)).get();
      if (row === undefined) return undefined;
      return {
        pass: row.pass,
        output: JSON.parse(row.outputJson) as Record<string, unknown>,
        rawResult: row.rawResultJson,
        salvage: row.salvage,
        latencyMs: row.latencyMs,
      };
    },

    async set(key: string, call: CachedPassCall): Promise<void> {
      db.insert(passCache)
        .values({
          key,
          pass: call.pass,
          outputJson: JSON.stringify(call.output),
          rawResultJson: call.rawResult,
          salvage: call.salvage,
          latencyMs: call.latencyMs,
          createdAt: new Date(),
        })
        .onConflictDoNothing()
        .run();
    },
  };
}

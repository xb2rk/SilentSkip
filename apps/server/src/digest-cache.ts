import { createHash } from "node:crypto";
import type { DigestBundle, ProjectProfile } from "@silentskip/contracts";

/**
 * Configuration options for the in-memory DigestCache.
 */
export interface DigestCacheOptions {
  /** Maximum number of compiled digest bundles to hold in memory. Defaults to 10. */
  readonly maxEntries?: number;
  /** Maximum time-to-live for worktree-backed digests in milliseconds. Defaults to 30,000ms (30s). */
  readonly worktreeTtlMs?: number;
}

interface CacheEntry {
  readonly digest: DigestBundle;
  readonly isWorktree: boolean;
  readonly cachedAt: number;
}

/**
 * In-memory LRU cache for compiled `DigestBundle` instances.
 *
 * Rationale:
 * Compiling a digest bundle (`buildDigest`) requires reading all source files via git,
 * parsing ASTs (FCC/FCG), parsing CSV tables, extracting facts, and running 13 deterministic
 * engine checks (1.5s–4.5s CPU time).
 *
 * For immutable commit ranges (`baseCommit` + `currentCommit`), the digest is pure and
 * completely deterministic for a given project profile. Caching it eliminates redundant
 * AST/CSV parsing across:
 * - Multi-turn What-If conversations (every user turn asks follow-up questions).
 * - Frequent navigations between Compare, History, and What-If pages.
 * - Pinning anchors in What-If sessions.
 */
export class DigestCache {
  private readonly maxEntries: number;
  private readonly worktreeTtlMs: number;
  private readonly entries = new Map<string, CacheEntry>();

  constructor(options: DigestCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 10;
    this.worktreeTtlMs = options.worktreeTtlMs ?? 30_000;
  }

  /**
   * Generates a deterministic cache key based on repo path, commit hashes, and profile.
   */
  static computeKey(
    rootPath: string,
    baseCommit: string,
    currentCommit: string | null,
    profile?: ProjectProfile,
  ): string {
    const profileJson = profile === undefined ? "" : JSON.stringify(profile);
    const profileHash = createHash("sha256").update(profileJson, "utf8").digest("hex").slice(0, 16);
    return `${rootPath}::${baseCommit}::${currentCommit ?? "WORKTREE"}::${profileHash}`;
  }

  /**
   * Retrieves a cached digest bundle if present and valid.
   * Committed ranges never expire (until evicted by LRU).
   * Worktree-backed digests expire after `worktreeTtlMs`.
   */
  get(key: string): DigestBundle | null {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return null;
    }

    if (entry.isWorktree && Date.now() - entry.cachedAt > this.worktreeTtlMs) {
      this.entries.delete(key);
      return null;
    }

    // Refresh LRU order (delete & re-insert)
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.digest;
  }

  /**
   * Stores a compiled digest bundle in the cache, evicting the least recently used entry if full.
   */
  set(key: string, digest: DigestBundle, isWorktree: boolean): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    } else if (this.entries.size >= this.maxEntries) {
      // Evict least recently used (first key in insertion order)
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }

    this.entries.set(key, {
      digest,
      isWorktree,
      cachedAt: Date.now(),
    });
  }

  /**
   * Evicts all entries belonging to a specific repository path.
   */
  invalidateProject(rootPath: string): void {
    for (const key of this.entries.keys()) {
      if (key.startsWith(`${rootPath}::`)) {
        this.entries.delete(key);
      }
    }
  }

  /**
   * Clears the entire cache.
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Returns current count of cached digest bundles.
   */
  get size(): number {
    return this.entries.size;
  }
}

/** Global singleton cache instance for the server runtime. */
export const globalDigestCache = new DigestCache();

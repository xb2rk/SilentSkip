import type { DigestBundle } from "@silentskip/contracts";
import { describe, expect, it } from "vitest";
import { DigestCache } from "../src/digest-cache";

function createDummyDigest(title: string): DigestBundle {
  return {
    schemaVersion: 2,
    refs: {
      base: { ref: "main", commitHash: "c1" },
      current: { ref: "feature", commitHash: "c2" },
    },
    title,
  } as unknown as DigestBundle;
}

describe("DigestCache", () => {
  it("computes deterministic keys based on arguments", () => {
    const dummyProfile = {
      conventions: [],
    } as unknown as import("@silentskip/contracts").ProjectProfile;
    const key1 = DigestCache.computeKey("/repo", "c1", "c2", dummyProfile);
    const key2 = DigestCache.computeKey("/repo", "c1", "c2", dummyProfile);
    const key3 = DigestCache.computeKey("/repo", "c1", "c3", dummyProfile);

    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key1).toContain("c1::c2");
  });

  it("stores and retrieves cached digests", () => {
    const cache = new DigestCache({ maxEntries: 3 });
    const digest = createDummyDigest("d1");
    const key = "repo::c1::c2::hash";

    expect(cache.get(key)).toBeNull();
    cache.set(key, digest, false);
    expect(cache.get(key)).toBe(digest);
  });

  it("evicts least recently used entries when exceeding maxEntries", () => {
    const cache = new DigestCache({ maxEntries: 2 });
    const d1 = createDummyDigest("d1");
    const d2 = createDummyDigest("d2");
    const d3 = createDummyDigest("d3");

    cache.set("k1", d1, false);
    cache.set("k2", d2, false);

    // Access k1 to make it more recently used than k2
    expect(cache.get("k1")).toBe(d1);

    // Adding k3 should evict k2 (LRU)
    cache.set("k3", d3, false);

    expect(cache.get("k1")).toBe(d1);
    expect(cache.get("k2")).toBeNull();
    expect(cache.get("k3")).toBe(d3);
  });

  it("expires worktree digests after worktreeTtlMs", async () => {
    const cache = new DigestCache({ worktreeTtlMs: 20 });
    const d1 = createDummyDigest("d1");

    cache.set("k_worktree", d1, true);
    expect(cache.get("k_worktree")).toBe(d1);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(cache.get("k_worktree")).toBeNull();
  });

  it("invalidates all entries belonging to a given repository root path", () => {
    const cache = new DigestCache();
    cache.set("/repo1::c1::c2::h1", createDummyDigest("d1"), false);
    cache.set("/repo1::c1::c3::h2", createDummyDigest("d2"), false);
    cache.set("/repo2::c1::c2::h3", createDummyDigest("d3"), false);

    expect(cache.size).toBe(3);
    cache.invalidateProject("/repo1");

    expect(cache.size).toBe(1);
    expect(cache.get("/repo1::c1::c2::h1")).toBeNull();
    expect(cache.get("/repo2::c1::c2::h3")).not.toBeNull();
  });
});

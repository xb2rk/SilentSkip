import { describe, expect, it } from "vitest";
import type { CachedPassCall, InseaRunRequest, PassCache } from "../src/index";
import { passCallKey, withPassCache } from "../src/index";

/** A call as a pass would build it — the shape the key has to cover. */
const TASK_FILE = {
  uploadName: "task.json",
  mimeType: "application/json",
  content: '{"goal":null}',
};
const ANCHORS_FILE = {
  uploadName: "anchors.jsonl",
  mimeType: "application/x-ndjson",
  content: '{"id":"a"}',
};

const REQUEST: InseaRunRequest = {
  url: "https://example.test/run",
  apiKey: "k",
  prompt: "Read unit 1 of 2.",
  manifestJson: '{"version":"1.0.0","stage":"read"}',
  attachments: [TASK_FILE, ANCHORS_FILE],
};

/** Minimal in-memory cache so the tests do not need SQLite. */
function memoryCache(): { cache: PassCache; store: Map<string, CachedPassCall> } {
  const store = new Map<string, CachedPassCall>();
  return {
    store,
    cache: {
      get: (key) => Promise.resolve(store.get(key)),
      set: (key, call) => {
        store.set(key, call);
        return Promise.resolve();
      },
    },
  };
}

const OK_OUTPUT = { findings: [], unknowns: [], negativeResults: [], needMore: [] };

/** Live runner that records how many times it was actually asked. */
function countingRunner(): {
  runner: (request: InseaRunRequest) => Promise<{
    output: Record<string, unknown>;
    rawResult: string;
    salvage: "clean";
    latencyMs: number;
  }>;
  calls: () => number;
} {
  let calls = 0;
  return {
    calls: () => calls,
    runner: async () => {
      calls += 1;
      return { output: OK_OUTPUT, rawResult: '{"findings":[]}', salvage: "clean", latencyMs: 4200 };
    },
  };
}

describe("passCallKey", () => {
  it("keys on everything the model sees and nothing about the transport", () => {
    const key = passCallKey(REQUEST);
    // URL, key and timeout cannot change the answer, so they are not part of the key.
    expect(
      passCallKey({
        ...REQUEST,
        url: "https://other.test/run",
        apiKey: "other",
        timeoutMs: 5,
      }),
    ).toBe(key);
    expect(passCallKey({ ...REQUEST, prompt: "Read unit 2 of 2." })).not.toBe(key);
    expect(passCallKey({ ...REQUEST, manifestJson: '{"version":"1.0.0","stage":"map"}' })).not.toBe(
      key,
    );
    expect(
      passCallKey({
        ...REQUEST,
        attachments: [{ ...TASK_FILE, content: '{"goal":"refactor"}' }],
      }),
    ).not.toBe(key);
    // Order is part of the input: passes build attachments deterministically, so a swap is a new call.
    expect(passCallKey({ ...REQUEST, attachments: [...REQUEST.attachments].reverse() })).not.toBe(
      key,
    );
  });
});

describe("withPassCache", () => {
  it("answers a repeated call from the cache without spending AI time", async () => {
    const { cache, store } = memoryCache();
    const live = countingRunner();
    const runner = withPassCache(live.runner, cache);

    const first = await runner(REQUEST);
    expect(first.cached).toBeUndefined();
    expect(first.latencyMs).toBe(4200);

    const second = await runner(REQUEST);
    expect(live.calls()).toBe(1);
    expect(second.cached).toBe(true);
    // A hit reports 0 ms: the run must not claim time it did not spend.
    expect(second.latencyMs).toBe(0);
    expect(second.output).toEqual(OK_OUTPUT);
    expect(second.salvage).toBe("clean");
    // The row records which pass the call belonged to (read from the manifest it was built with).
    expect([...store.values()][0]?.pass).toBe("read");
  });

  it("never caches a failed call", async () => {
    const { cache, store } = memoryCache();
    const runner = withPassCache(async () => {
      throw new Error("workflow exploded");
    }, cache);
    await expect(runner(REQUEST)).rejects.toThrow("workflow exploded");
    expect(store.size).toBe(0);
  });

  it("falls back to the live call when the cache itself fails", async () => {
    const phases: string[] = [];
    const broken: PassCache = {
      get: () => Promise.reject(new Error("no such table: pass_cache")),
      set: () => Promise.reject(new Error("disk full")),
    };
    const live = countingRunner();
    const runner = withPassCache(live.runner, broken, {
      onError: (_error, phase) => phases.push(phase),
    });

    const result = await runner(REQUEST);
    expect(result.output).toEqual(OK_OUTPUT);
    expect(live.calls()).toBe(1);
    // Both halves of the cache failed, both were reported, and the call still answered.
    expect(phases).toEqual(["get", "set"]);
  });
});

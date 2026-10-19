import { createHash } from "node:crypto";
import type { InseaRunRequest } from "../insea/types.js";
import type { CachedPassCall, PassCache, WorkflowRunner } from "./types.js";

/**
 * Pass-result cache (Phase 3): a runner decorator that answers byte-identical calls from a
 * content-addressed store instead of the network.
 *
 * Keying is by *content*, not by pass or unit: the hash covers the prompt (which carries the
 * pass instructions, the unit/chunk framing and the L1/L3 constraint lines), the manifest
 * (stage, refs, goal/lens, attachment names and byte sizes) and every attachment's name and
 * bytes. Anything the model sees that can change the answer changes the key; anything that
 * cannot (workflow URL, API key, timeout) deliberately does not. A prompt edit — even a version
 * bump with no other change — changes the prompt text and therefore the key.
 *
 * Guarantees:
 * - Only successful calls are stored; an error is never cached, so a rerun retries it.
 * - A hit reports `cached: true` with `latencyMs: 0` — a run must not claim time it did not spend.
 * - The cache is an optimization, never an authority: when the cache itself fails, the call
 *   falls through to the live workflow and the failure is reported through `onError`.
 */

/** Which half of the cache failed — context for logs, never control flow. */
export type PassCachePhase = "get" | "set";

export interface PassCacheOptions {
  /** Report a broken cache; the run continues against the live workflow either way. */
  readonly onError?: (error: unknown, phase: PassCachePhase) => void;
}

/**
 * Wrap a runner with a cache. The returned runner keeps the original failure semantics: errors
 * thrown by the underlying runner propagate untouched, and nothing is stored for them.
 */
export function withPassCache(
  runner: WorkflowRunner,
  cache: PassCache,
  options: PassCacheOptions = {},
): WorkflowRunner {
  return async (request) => {
    const key = passCallKey(request);
    const hit = await lookup(cache, key, options);
    if (hit !== undefined) {
      return {
        output: hit.output,
        rawResult: hit.rawResult,
        salvage: hit.salvage,
        latencyMs: 0,
        cached: true,
      };
    }
    const result = await runner(request);
    try {
      await cache.set(key, {
        pass: stageOf(request.manifestJson),
        output: result.output,
        rawResult: result.rawResult,
        salvage: result.salvage,
        latencyMs: result.latencyMs,
      });
    } catch (error) {
      options.onError?.(error, "set");
    }
    return result;
  };
}

/** Sha-256 over everything that decides the answer (see the module comment). */
export function passCallKey(request: InseaRunRequest): string {
  const hash = createHash("sha256");
  hash.update(request.prompt, "utf8");
  for (const attachment of request.attachments) {
    // NUL separators keep boundaries unambiguous: `a\0bc` can never hash like `ab\0c`.
    hash.update("\u0000", "utf8");
    hash.update(attachment.uploadName, "utf8");
    hash.update("\u0000", "utf8");
    hash.update(attachment.content, "utf8");
  }
  hash.update("\u0000", "utf8");
  hash.update(request.manifestJson, "utf8");
  return hash.digest("hex");
}

async function lookup(
  cache: PassCache,
  key: string,
  options: PassCacheOptions,
): Promise<CachedPassCall | undefined> {
  try {
    return await cache.get(key);
  } catch (error) {
    options.onError?.(error, "get");
    return undefined;
  }
}

/** Pass (stage) recorded on the cache row — read from the manifest the call was built with. */
function stageOf(manifestJson: string): string {
  try {
    const parsed = JSON.parse(manifestJson) as { stage?: unknown };
    return typeof parsed.stage === "string" ? parsed.stage : "unknown";
  } catch {
    return "unknown";
  }
}

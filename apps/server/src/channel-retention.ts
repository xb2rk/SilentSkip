import type { SseChannel } from "./sse-channel";

/** How long terminal SSE channels stay in memory for late replaying before eviction. */
export const CHANNEL_RETENTION_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Schedule deletion of one channel after the retention TTL: connected clients still finish their
 * replay, but finished runs (reviews and what-if turns alike) cannot accumulate forever.
 */
export function scheduleChannelEviction<T extends { type: string }>(
  channels: Map<string, SseChannel<T>>,
  key: string,
): void {
  setTimeout(() => {
    channels.delete(key);
  }, CHANNEL_RETENTION_TTL_MS).unref?.();
}

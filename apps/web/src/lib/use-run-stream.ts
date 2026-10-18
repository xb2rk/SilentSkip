import { type ReviewStreamEvent, ReviewStreamEventSchema } from "@silentskip/contracts";
import { useEffect, useState } from "react";

/**
 * Subscribe to a run's SSE stream (`GET /api/reviews/:runId/stream`).
 *
 * The server replays buffered events and closes after the terminal event. `EventSource` would
 * auto-reconnect after that close, so this hook closes the connection explicitly on the first
 * terminal event — and treats connection errors as terminal too, leaving `useRun`'s polling as
 * the convergence path. The returned `events` list is append-only for the lifetime of `runId`.
 */
export function useRunStream(runId: string | null): {
  readonly events: readonly ReviewStreamEvent[];
  readonly connected: boolean;
  readonly streamError: boolean;
} {
  const [events, setEvents] = useState<readonly ReviewStreamEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [streamError, setStreamError] = useState(false);

  useEffect(() => {
    setEvents([]);
    setConnected(false);
    setStreamError(false);
    if (runId === null) return;

    const source = new EventSource(`/api/reviews/${encodeURIComponent(runId)}/stream`);
    const handle = (raw: MessageEvent<string>): void => {
      try {
        const parsed = ReviewStreamEventSchema.safeParse(JSON.parse(raw.data));
        if (!parsed.success) return;
        const event = parsed.data;
        setEvents((current) => [...current, event]);
        if (event.type !== "stage") {
          source.close();
          setConnected(false);
        }
      } catch {
        // Malformed frame — ignore; polling still converges on the persisted truth.
      }
    };

    source.onopen = () => setConnected(true);
    // The server sends named events; named events do not fire `onmessage`.
    for (const name of ["stage", "completed", "failed", "cancelled"]) {
      source.addEventListener(name, handle as EventListener);
    }
    source.onerror = () => {
      setStreamError(true);
      setConnected(false);
      source.close();
    };
    return () => source.close();
  }, [runId]);

  return { events, connected, streamError };
}

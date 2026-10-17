/**
 * Replayable SSE event channel shared by review runs and What-If turns (E6).
 *
 * `emit` never throws on subscriber errors (a client that disconnected must not kill the
 * background work); `attach` replays the buffer to a late listener, then keeps delivering
 * until the first non-`stage` (terminal) event — so streaming endpoints are correct for both
 * live and already-finished work.
 */
export class SseChannel<TEvent extends { type: string }> {
  private readonly events: TEvent[] = [];
  private readonly subscribers = new Set<(event: TEvent) => Promise<void>>();
  private terminal = false;
  private readonly closed: Promise<void>;
  private resolveClosed: () => void = () => {};

  constructor() {
    this.closed = new Promise<void>((resolve) => {
      this.resolveClosed = resolve;
    });
  }

  async emit(event: TEvent): Promise<void> {
    this.events.push(event);
    for (const subscriber of [...this.subscribers]) {
      try {
        await subscriber(event);
      } catch {
        // Subscriber gone (client aborted) — the work must keep going.
      }
    }
    if (event.type !== "stage") {
      this.terminal = true;
      this.subscribers.clear();
      this.resolveClosed();
    }
  }

  /** Replay the buffer to `listener`, then keep delivering until the terminal event. */
  async attach(listener: (event: TEvent) => Promise<void>): Promise<void> {
    for (const event of this.events) await listener(event);
    if (this.terminal) return;
    this.subscribers.add(listener);
    await this.closed;
  }
}

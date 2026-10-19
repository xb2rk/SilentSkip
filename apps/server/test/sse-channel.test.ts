import { describe, expect, it } from "vitest";
import { SseChannel } from "../src/sse-channel";

type Event = { type: string; value?: number };

/**
 * The channel is shared by review runs and What-If turns. A slow subscriber must not delay the
 * pipeline (or the other listeners), and a disconnected subscriber must never throw into work.
 */
describe("SseChannel", () => {
  it("delivers to every subscriber concurrently", async () => {
    const channel = new SseChannel<Event>();
    const received: string[] = [];
    let releaseSlow: () => void = () => undefined;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });

    void channel.attach(async (event) => {
      if (event.type === "stage") await slowGate;
      received.push(`slow:${event.type}`);
    });
    void channel.attach(async (event) => {
      received.push(`fast:${event.type}`);
    });

    const emitted = channel.emit({ type: "stage", value: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(received).toContain("fast:stage");

    releaseSlow();
    await emitted;
    expect(received).toEqual(["fast:stage", "slow:stage"]);
  });

  it("survives a throwing subscriber and closes on the terminal event", async () => {
    const channel = new SseChannel<Event>();
    let seen = 0;
    void channel.attach(async () => {
      seen += 1;
      throw new Error("client gone");
    });

    await channel.emit({ type: "stage" });
    await channel.emit({ type: "completed" });
    expect(seen).toBe(2);
  });
});

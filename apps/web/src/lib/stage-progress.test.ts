import type { ReviewStreamEvent } from "@silentskip/contracts";
import { describe, expect, it } from "vitest";
import { stageStates, stageTotals } from "./stage-progress";

type StageEvent = Extract<ReviewStreamEvent, { type: "stage" }>;

/** Two units of one region each, then a re-read of unit 1 in the L1 coverage round. */
const READS: StageEvent[] = [
  { type: "stage", stage: "read", state: "started", unit: 1, units: 2, round: 1 },
  {
    type: "stage",
    stage: "read",
    state: "completed",
    unit: 1,
    units: 2,
    round: 1,
    latencyMs: 1000,
  },
  { type: "stage", stage: "read", state: "started", unit: 2, units: 2, round: 1 },
  {
    type: "stage",
    stage: "read",
    state: "completed",
    unit: 2,
    units: 2,
    round: 1,
    latencyMs: 3000,
  },
  { type: "stage", stage: "read", state: "started", unit: 1, units: 2, round: 2 },
  { type: "stage", stage: "read", state: "completed", unit: 1, units: 2, round: 2, latencyMs: 500 },
];

describe("stageStates", () => {
  it("accumulates calls and time instead of overwriting the last call", () => {
    const read = stageStates(READS).read;
    expect(read.calls).toBe(3);
    expect(read.totalMs).toBe(4500);
    expect(read.slowestMs).toBe(3000);
    expect(read.state).toBe("done");
  });

  it("counts a coverage re-read as another call but not as another region", () => {
    const read = stageStates(READS).read;
    expect(read.doneRegions).toBe(2);
    expect(read.round).toBe(2);
  });

  it("stays pending for a stage the stream never reached, and active while it runs", () => {
    const states = stageStates(READS);
    expect(states.synthesize).toEqual({
      state: "pending",
      calls: 0,
      totalMs: 0,
      slowestMs: 0,
      doneRegions: 0,
    });
    expect(states.read.state).toBe("done");
    expect(stageStates(READS.slice(0, 5)).read.state).toBe("active");
  });

  it("ignores terminal events", () => {
    const events: ReviewStreamEvent[] = [
      {
        type: "completed",
        verdict: "pass",
        qualityScore: 90,
        findings: 1,
        fallbackReason: null,
        degradedReason: null,
      },
    ];
    expect(stageStates(events).synthesize.state).toBe("pending");
  });
});

describe("stageTotals", () => {
  it("sums every stage and names the slowest call, without counting the digest as an AI call", () => {
    const events: StageEvent[] = [
      { type: "stage", stage: "digest", state: "started" },
      { type: "stage", stage: "digest", state: "completed" },
      { type: "stage", stage: "map", state: "completed", latencyMs: 300 },
      { type: "stage", stage: "synthesize", state: "completed", latencyMs: 900 },
    ];
    expect(stageTotals(stageStates(events))).toEqual({
      calls: 2,
      totalMs: 1200,
      slowestMs: 900,
      slowestStage: "synthesize",
    });
  });

  it("reports nothing slow before the first call returns", () => {
    expect(stageTotals(stageStates([{ type: "stage", stage: "read", state: "started" }]))).toEqual({
      calls: 0,
      totalMs: 0,
      slowestMs: 0,
      slowestStage: null,
    });
  });
});

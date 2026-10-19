import type { ReviewStreamEvent } from "@silentskip/contracts";

/** Pipeline stages in the order the server runs them; also the order the progress card lists. */
export const STAGE_ORDER = ["digest", "map", "read", "dig", "synthesize"] as const;

export type StageName = (typeof STAGE_ORDER)[number];

/**
 * Accumulated progress of one pipeline stage.
 *
 * The stream is append-only and the server replays it from the beginning when the page attaches
 * mid-run, so this is a plain left-to-right fold — never a "current value" overwrite. That matters
 * because one stage runs many calls (a call per region, per chunk, per repair round): showing only
 * the newest `latencyMs` reported the last call as if it were the whole stage, which made a
 * 12-minute reading step look like a 90-second one.
 */
export interface StageState {
  readonly state: "pending" | "active" | "done";
  /** Finished calls in this stage — each one an AI request that returned. */
  readonly calls: number;
  /** Sum of those calls' latencies: the stage's real cost. */
  readonly totalMs: number;
  /** Slowest single call, in ms — the number that explains a wall clock that felt stuck. */
  readonly slowestMs: number;
  /** Regions (reading units) that produced at least one reading, for `vùng X/Y`. */
  readonly doneRegions: number;
  /** Progress reported by the newest event of the stage, when it reports any. */
  readonly unit?: number;
  readonly units?: number;
  readonly chunk?: number;
  readonly chunks?: number;
  readonly round?: number;
}

function emptyStage(): StageState {
  return { state: "pending", calls: 0, totalMs: 0, slowestMs: 0, doneRegions: 0 };
}

/** Folds the streamed stage events into one accumulated state per stage. */
export function stageStates(events: readonly ReviewStreamEvent[]): Record<StageName, StageState> {
  const states: Record<StageName, StageState> = {
    digest: emptyStage(),
    map: emptyStage(),
    read: emptyStage(),
    dig: emptyStage(),
    synthesize: emptyStage(),
  };
  /** Regions already read, so re-reading the same unit in L1 is not a second region. */
  const doneRegions = new Set<number>();
  for (const event of events) {
    if (event.type !== "stage") continue;
    const previous = states[event.stage];
    const completed = event.state === "completed";
    const latencyMs = event.latencyMs ?? 0;
    if (completed && event.unit !== undefined) doneRegions.add(event.unit);
    states[event.stage] = {
      state: completed ? "done" : "active",
      calls: previous.calls + (completed ? 1 : 0),
      totalMs: previous.totalMs + (completed ? latencyMs : 0),
      slowestMs: completed ? Math.max(previous.slowestMs, latencyMs) : previous.slowestMs,
      doneRegions: doneRegions.size,
      ...(event.unit === undefined ? {} : { unit: event.unit }),
      ...(event.units === undefined ? {} : { units: event.units }),
      ...(event.chunk === undefined ? {} : { chunk: event.chunk }),
      ...(event.chunks === undefined ? {} : { chunks: event.chunks }),
      ...(event.round === undefined
        ? previous.round === undefined
          ? {}
          : { round: previous.round }
        : { round: Math.max(previous.round ?? 1, event.round) }),
    };
  }
  return states;
}

export interface StageTotals {
  readonly calls: number;
  readonly totalMs: number;
  readonly slowestMs: number;
  readonly slowestStage: StageName | null;
}

/**
 * Sums a stage snapshot into the one-line "why so slow" totals. The digest step is counted for time
 * (it is deterministic engine work with no latency reported) but not for calls: it makes no AI call.
 */
export function stageTotals(states: Record<StageName, StageState>): StageTotals {
  let calls = 0;
  let totalMs = 0;
  let slowestMs = 0;
  let slowestStage: StageName | null = null;
  for (const stage of STAGE_ORDER) {
    const state = states[stage];
    if (stage !== "digest") calls += state.calls;
    totalMs += state.totalMs;
    if (state.slowestMs > slowestMs) {
      slowestMs = state.slowestMs;
      slowestStage = stage;
    }
  }
  return { calls, totalMs, slowestMs, slowestStage };
}

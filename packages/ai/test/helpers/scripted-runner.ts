import type { InseaRunRequest, InseaRunResult } from "../../src/insea/types.js";
import type { WorkflowRunner } from "../../src/passes/types.js";

/**
 * A scripted Insea runner for offline tests: per-stage outputs, optionally computed from the
 * request and the number of previous calls of that stage (so multi-unit reads can differ).
 * Records every request for assertions.
 */

/** A stage's scripted value — a fixed output or a function of (request, callIndex). */
export type ScriptValue =
  | Record<string, unknown>
  | ((request: InseaRunRequest, callIndex: number) => Record<string, unknown>);

/** Scripted runner bundle: the runner itself plus the recorded requests. */
export interface ScriptedRunner {
  readonly runner: WorkflowRunner;
  readonly calls: InseaRunRequest[];
}

/** Builds a scripted runner; an unscripted stage throws (the test wants it to be impossible). */
export function scriptedRunner(script: Record<string, ScriptValue>): ScriptedRunner {
  const calls: InseaRunRequest[] = [];
  const counters = new Map<string, number>();
  const runner: WorkflowRunner = async (request) => {
    const stage = stageOf(request);
    const entry = script[stage];
    if (entry === undefined) throw new Error(`no scripted output for stage "${stage}"`);
    const callIndex = counters.get(stage) ?? 0;
    counters.set(stage, callIndex + 1);
    calls.push(request);
    const output = typeof entry === "function" ? entry(request, callIndex) : entry;
    const result: InseaRunResult = {
      output,
      rawResult: JSON.stringify(output),
      salvage: "clean",
      latencyMs: 7,
    };
    return result;
  };
  return { runner, calls };
}

/** The stage recorded in a request's Manifest field. */
export function stageOf(request: InseaRunRequest): string {
  const manifest = JSON.parse(request.manifestJson) as { stage?: string };
  return manifest.stage ?? "unknown";
}

/** The attachments of a request by upload name. */
export function attachmentOf(
  request: InseaRunRequest,
  uploadName: string,
): InseaRunRequest["attachments"][number] | undefined {
  return request.attachments.find((item) => item.uploadName === uploadName);
}

/** First call or a loud failure — keeps tests free of non-null assertions. */
export function firstCall(calls: readonly InseaRunRequest[]): InseaRunRequest {
  const call = calls[0];
  if (call === undefined) throw new Error("no recorded calls");
  return call;
}

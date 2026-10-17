import type { InseaRunRequest, WorkflowRunner } from "../../src/index";

/**
 * A scripted workflow runner for offline tests: one canned output per manifest `stage`.
 *
 * Records every request so tests can assert the multipart contract (attachments, manifest
 * stage, prompt content) without touching the network.
 */
export function scriptedRunner(script: Record<string, unknown>): {
  runner: WorkflowRunner;
  calls: InseaRunRequest[];
} {
  const calls: InseaRunRequest[] = [];
  const runner: WorkflowRunner = async (request) => {
    calls.push(request);
    const manifest = JSON.parse(request.manifestJson) as { stage: string };
    const output = script[manifest.stage];
    if (output === undefined) {
      throw new Error(`scripted runner has no output for stage "${manifest.stage}"`);
    }
    return {
      output: output as Record<string, unknown>,
      rawResult: JSON.stringify(output),
      salvage: "clean",
      latencyMs: 7,
    };
  };
  return { runner, calls };
}

/** First recorded call or a loud test failure — keeps tests free of non-null assertions. */
export function firstCall(calls: readonly InseaRunRequest[]): InseaRunRequest {
  const call = calls[0];
  if (call === undefined) throw new Error("expected at least one workflow call");
  return call;
}

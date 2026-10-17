import type {
  InseaAttachment,
  InseaRunRequest,
  InseaRunResult,
  InseaSalvage,
} from "../insea/types.js";

/** Executes one workflow call — injected so tests (and future callers) can swap the transport. */
export type WorkflowRunner = (request: InseaRunRequest) => Promise<InseaRunResult>;

/** Workflow connection settings resolved from server config (`AI_WORKFLOW_*`). */
export interface PassConfig {
  readonly workflowUrl: string | null;
  readonly apiKey: string | null;
  readonly timeoutMs?: number;
}

/** Which pass produced a result, with the prompt version and honest transport facts. */
export interface PassMeta {
  readonly pass: "digest_read" | "dig" | "synthesize";
  readonly promptVersion: string;
  readonly latencyMs: number;
  readonly salvage: InseaSalvage;
}

/** Dependencies of every pass call. */
export interface PassDeps {
  readonly runner: WorkflowRunner;
  readonly config: PassConfig;
}

/** Build the Insea request shared by all passes (url/key/timeout/signal wiring). */
export function buildRunRequest(
  deps: PassDeps,
  prompt: string,
  manifestJson: string,
  attachments: readonly InseaAttachment[],
  signal?: AbortSignal,
): InseaRunRequest {
  return {
    url: deps.config.workflowUrl ?? "",
    apiKey: deps.config.apiKey ?? "",
    prompt,
    manifestJson,
    attachments,
    ...(deps.config.timeoutMs === undefined ? {} : { timeoutMs: deps.config.timeoutMs }),
    ...(signal === undefined ? {} : { signal }),
  };
}

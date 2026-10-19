import type {
  InseaAttachment,
  InseaRunRequest,
  InseaRunResult,
  InseaSalvage,
} from "../insea/types.js";

/** Executes one workflow call — injected so tests (and future callers) can swap the transport. */
export type WorkflowRunner = (request: InseaRunRequest) => Promise<InseaRunResult>;

/**
 * Content-addressed store of workflow call results (one row per byte-identical call).
 * Implemented by the server on SQLite and injected as a runner decorator (`withPassCache`),
 * so a rerun of the same comparison — or a resume after a crash — replays the passes it has
 * already paid for instead of paying for them again. Optional everywhere: without it every
 * call goes to the network.
 */
export interface PassCache {
  get(key: string): Promise<CachedPassCall | undefined>;
  /** Called only with successful results — an error is never cached. */
  set(key: string, call: CachedPassCall): Promise<void>;
}

/** What one cached call must carry to replay it faithfully (and to be auditable in the table). */
export interface CachedPassCall {
  /** Pass (stage) that produced it — `map`, `read`, `dig`, `synthesize` or `whatif`. */
  readonly pass: string;
  readonly output: Record<string, unknown>;
  readonly rawResult: string;
  readonly salvage: InseaSalvage;
  /** Latency of the original live call, kept for auditing; a hit reports `latencyMs: 0`. */
  readonly latencyMs: number;
}

/** Workflow connection settings resolved from server config (`AI_WORKFLOW_*`). */
export interface PassConfig {
  readonly workflowUrl: string | null;
  readonly apiKey: string | null;
  readonly timeoutMs?: number;
  /**
   * Max `read` calls in flight (`AI_READ_CONCURRENCY` on the server). Reads are independent, so
   * overlapping them divides the reading wall time by up to this factor; the pipeline folds results
   * in unit order, so the report is byte-identical whatever the pool size is. Unset means one call
   * at a time — the pipeline never widens itself.
   */
  readonly readConcurrency?: number;
}

/** Which pass produced a result, with the prompt version and honest transport facts. */
export interface PassMeta {
  readonly pass: "map" | "read" | "dig" | "synthesize" | "whatif";
  readonly promptVersion: string;
  readonly latencyMs: number;
  readonly salvage: InseaSalvage;
  /** 1-based reading-unit index for `read` passes. */
  readonly unit?: number;
  /** 1-based chunk inside that unit (E7.5); both set together for chunked read calls. */
  readonly chunk?: number;
  /** Total chunks of that unit. */
  readonly chunks?: number;
  /** 1-based loop round when L1/L3 re-ran the pass. */
  readonly round?: number;
  /** True when the pass was answered from the call cache — no AI time was spent (`latencyMs` is 0). */
  readonly cached: boolean;
  /** Epoch ms when the call was dispatched — the span covers the cache lookup, so wall time is real. */
  readonly startedAt: number;
  /** Epoch ms when the answer was in hand. */
  readonly finishedAt: number;
  /** UTF-8 bytes this call sent: prompt + manifest + every attachment. 0 means "not measured". */
  readonly payloadBytes: number;
  /** Those bytes split by section, largest first. */
  readonly payloadSections: PassPayloadSection[];
}

/** One section of a call payload: the prompt, the manifest, or one attachment. */
export interface PassPayloadSection {
  readonly name: string;
  readonly bytes: number;
}

/** Honest accounting of one workflow call: when it ran, what it cost and what it was sent. */
export interface PassCallMeta {
  readonly latencyMs: number;
  readonly cached: boolean;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly payloadBytes: number;
  readonly payloadSections: PassPayloadSection[];
}

/** Dependencies of every pass call. */
export interface PassDeps {
  readonly runner: WorkflowRunner;
  readonly config: PassConfig;
}

/**
 * Run one pass call and account for it honestly: the span (cache lookup included), the transport
 * latency, whether the cache answered, and the bytes actually sent. Passes spread `meta` into their
 * `PassMeta`, so a persisted run always says what it paid and what it was sent — the inputs every
 * throughput and payload decision needs.
 */
export async function runPassCall(
  deps: PassDeps,
  input: {
    readonly prompt: string;
    readonly manifestJson: string;
    readonly attachments: readonly InseaAttachment[];
    readonly signal?: AbortSignal | undefined;
  },
): Promise<{ readonly result: InseaRunResult; readonly meta: PassCallMeta }> {
  const startedAt = Date.now();
  const result = await deps.runner(
    buildRunRequest(deps, input.prompt, input.manifestJson, input.attachments, input.signal),
  );
  return {
    result,
    meta: {
      latencyMs: result.latencyMs,
      cached: result.cached === true,
      startedAt,
      finishedAt: Date.now(),
      ...payloadAccounting(input.prompt, input.manifestJson, input.attachments),
    },
  };
}

/**
 * UTF-8 byte accounting of a call payload (prompt + manifest + attachments). Sections come back
 * largest first, so the biggest lever is the first thing a run report shows.
 */
export function payloadAccounting(
  prompt: string,
  manifestJson: string,
  attachments: readonly InseaAttachment[],
): { readonly payloadBytes: number; readonly payloadSections: PassPayloadSection[] } {
  const sections: PassPayloadSection[] = [
    { name: "prompt", bytes: Buffer.byteLength(prompt, "utf8") },
    { name: "manifest", bytes: Buffer.byteLength(manifestJson, "utf8") },
    ...attachments.map((attachment) => ({
      name: attachment.uploadName,
      bytes: Buffer.byteLength(attachment.content, "utf8"),
    })),
  ];
  sections.sort((a, b) => b.bytes - a.bytes || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    payloadBytes: sections.reduce((sum, section) => sum + section.bytes, 0),
    payloadSections: sections,
  };
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

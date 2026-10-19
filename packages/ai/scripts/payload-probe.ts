/**
 * Payload cost probe: `pnpm --filter @silentskip/ai payload:probe <projectId> <base> <current>
 * [--unit <n>] [--repeat <n>] [--variants <names>] [--goal <text>] [--content-check]`.
 *
 * Phase 5 asks "what actually costs time in a `read` call?" — this answers it with live calls:
 *
 * 1. **capture** — runs the real pipeline far enough to capture the production `read` request for
 *    one unit (the request comes from the pipeline's own runner, so the probe cannot drift from what
 *    the pipeline sends), then stops. Cost: one `map` call plus `--unit` read calls.
 * 2. **measure** — re-sends that request as-is and reshaped (no skeleton, no bodies, essential only,
 *    padded, no `DataList`, empty `Manifest`, token hunt) and prints bytes → latency.
 *
 * The reshaped payloads are byte/latency experiments, not quality ones: dropping an attachment is
 * meant to make the answer worse, and only the cost is reported. `--repeat` re-sends a variant
 * unchanged, which is how endpoint noise is told apart from a real effect. Nothing is cached — every
 * call is live, so a probe costs real AI time, and the dev server must be up for the digest.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { type DigestBundle, DigestBundleSchema } from "@silentskip/contracts";
import {
  AiError,
  applyPayloadVariant,
  type InseaAttachment,
  type InseaRunRequest,
  type InseaRunResult,
  type PassConfig,
  type PassPayloadSection,
  type PayloadVariant,
  payloadAccounting,
  runInseaWorkflow,
  runReviewPipeline,
  type WorkflowRunner,
} from "../src/index.js";

const USAGE =
  "usage: payload:probe <projectId> <baseRef> <currentRef> [--unit <n>] [--repeat <n>] " +
  "[--variants <name,name>] [--goal <text>] [--content-check]   (--unit 0 needs no project: the " +
  "ladder variants are self-contained)";

/** Name of the file the token hunt plants, so the prompt and the attachment cannot disagree. */
const TOKEN_FILE = "probe-token.txt";

/** The token hunt's prompt: the only correct answer sits inside an attached file. */
const TOKEN_PROMPT =
  `Return STRICT JSON only, no prose. The attached file ${TOKEN_FILE} contains a line ` +
  '"TOKEN=<value>". Reply with exactly {"token":"<value>"} using the value you read.';

/**
 * Byte ladder: trivial prompt plus filler, so one step costs seconds instead of minutes. This is how
 * the endpoint's payload ceiling is found — production-size payloads take 1-2 minutes each, and the
 * ceiling decides how far chunk merging can go.
 */
const LADDER: readonly { readonly name: string; readonly padBytes: number }[] = [
  { name: "token-min", padBytes: 0 },
  { name: "pad-350k", padBytes: 350 * 1024 },
  { name: "pad-450k", padBytes: 450 * 1024 },
  { name: "pad-550k", padBytes: 550 * 1024 },
  { name: "pad-650k", padBytes: 650 * 1024 },
];

/** The variant names, in report order. `token-hunt` additionally needs `--content-check`. */
const KNOWN_VARIANTS = [
  "full",
  "no-skeleton",
  "no-bodies",
  "no-anchors",
  "essential",
  "padded-400k",
  "no-datalist",
  "empty-manifest",
  "token-hunt",
  ...LADDER.map((step) => step.name),
];

/**
 * Probe timeout ceiling. The server's `AI_WORKFLOW_TIMEOUT_MS` budgets a whole run and can be hours,
 * which would leave a probe hanging on one stuck call; ten minutes is well past every call measured.
 */
const PROBE_MAX_TIMEOUT_MS = 600_000;

/** Thrown by the capture runner once the wanted read call has answered — nothing else is paid for. */
class CaptureComplete extends Error {
  constructor() {
    super("captured the read call");
    this.name = "CaptureComplete";
  }
}

const envPath = resolve(process.cwd(), "../../.env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const options = parseOptions(process.argv.slice(2));
if (options === null) {
  console.error(USAGE);
  process.exit(2);
}

const token = randomUUID().slice(0, 12);
const variants = buildVariants(options, token);
if (variants.length === 0) {
  console.error(`${USAGE}\nunknown --variants; known names: ${KNOWN_VARIANTS.join(", ")}`);
  process.exit(2);
}

const workflowUrl = process.env.AI_WORKFLOW_URL ?? null;
const apiKey = process.env.AI_WORKFLOW_API_KEY ?? null;
if (workflowUrl === null || apiKey === null) {
  console.error("missing AI_WORKFLOW_URL / AI_WORKFLOW_API_KEY (checked repo-root .env)");
  process.exit(1);
}

const config: PassConfig = {
  workflowUrl,
  apiKey,
  timeoutMs: probeTimeoutMs(),
  readConcurrency: 1,
};

// `--unit 0` skips capture: the ladder variants are self-contained, so neither a digest nor a
// production payload is needed (and no dev server either). Otherwise the pipeline runs until the
// wanted call has answered and hands over the request it really sent.
const digest = options.unit === 0 ? null : await fetchDigest(options);
const captured = digest === null ? null : await captureReadCall(digest, options, config);
if (options.unit > 0 && captured === null) {
  console.error(
    `no read call captured: the reading phase never reached unit ${options.unit} (fewer than ${options.unit} read call(s) answered)`,
  );
  process.exit(1);
}

const base: InseaRunRequest = captured?.request ?? {
  url: config.workflowUrl ?? "",
  apiKey: config.apiKey ?? "",
  prompt: "",
  manifestJson: "{}",
  attachments: [],
  ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
};

if (captured !== null) {
  const production = payloadAccounting(
    captured.request.prompt,
    captured.request.manifestJson,
    captured.request.attachments,
  );
  console.log(
    `captured read call: unit ${options.unit}, ${formatBytes(production.payloadBytes)}, ` +
      `${formatSeconds(captured.result.latencyMs)}, salvage ${captured.result.salvage}`,
  );
  console.log(`  sections: ${formatSections(production.payloadSections)}`);
}

const measurements = await measure(base, variants, options, token);
printReport(measurements, token);
process.exit(measurements.some((entry) => entry.error !== null) ? 1 : 0);

/** Options of one probe run. */
interface Options {
  readonly projectId: string;
  readonly base: string;
  readonly current: string;
  /** Which read call of the run to capture (1-based); 0 skips capture and runs the ladder only. */
  readonly unit: number;
  /** How often each variant is sent: 2+ turns endpoint noise into a measured spread. */
  readonly repeat: number;
  readonly goal: string;
  /** Restrict the run to these variant names; `null` means every variant. */
  readonly variants: readonly string[] | null;
  /** Add the token hunt, which checks whether the model reads `DataList` content at all. */
  readonly contentCheck: boolean;
}

/** One call's outcome. `error` is recorded instead of thrown, so one bad variant does not end it. */
interface Measurement {
  readonly variant: string;
  readonly run: number;
  readonly bytes: number;
  readonly sections: readonly PassPayloadSection[];
  readonly latencyMs: number;
  readonly salvage: string;
  readonly error: string | null;
  readonly note: string | null;
}

/** The variants the user asked for — every one by default, the token hunt only with a flag. */
function buildVariants(options: Options, token: string): PayloadVariant[] {
  const all: PayloadVariant[] = [
    { name: "full" },
    { name: "no-skeleton", drop: ["skeleton.json"] },
    { name: "no-bodies", drop: ["bodies.jsonl"] },
    { name: "no-anchors", drop: ["anchors.jsonl"] },
    { name: "essential", keep: ["task.json", "unit.json", "facts.json"] },
    { name: "padded-400k", padBytes: 400_000 },
    { name: "no-datalist", emptyAttachments: true },
    { name: "empty-manifest", emptyManifest: true },
    ...tokenHunt(token),
    ...LADDER.map((step) => ladderVariant(step, token)),
  ];
  const wanted = options.variants;
  return all.filter(
    (variant) =>
      (wanted === null || wanted.includes(variant.name)) &&
      (variant.name !== "token-hunt" || options.contentCheck),
  );
}

/**
 * The token hunt asks a question whose only correct answer sits inside an attached file: if the model
 * answers it, the `DataList` is really being read — which is what makes payload work worth doing.
 */
function tokenHunt(token: string): PayloadVariant[] {
  return [
    {
      name: "token-hunt",
      prompt: TOKEN_PROMPT,
      extraAttachment: tokenAttachment(token),
    },
  ];
}

/** The token file planted by the token hunt and by every ladder step. */
function tokenAttachment(token: string): InseaAttachment {
  return { uploadName: TOKEN_FILE, mimeType: "text/plain", content: `TOKEN=${token}\n` };
}

/**
 * One ladder step: none of the production attachments, just the token file plus filler. The prompt is
 * trivial on purpose — otherwise each step would cost a minute of analysis instead of seconds, and the
 * question here is purely "how many bytes does the endpoint take?".
 */
function ladderVariant(
  step: { readonly name: string; readonly padBytes: number },
  token: string,
): PayloadVariant {
  return {
    name: step.name,
    prompt: TOKEN_PROMPT,
    emptyAttachments: true,
    extraAttachment: tokenAttachment(token),
    ...(step.padBytes === 0 ? {} : { padBytes: step.padBytes }),
  };
}

/** Capture one production `read` request by running the pipeline until that call has answered. */
async function captureReadCall(
  digest: DigestBundle,
  options: Options,
  config: PassConfig,
): Promise<{ readonly request: InseaRunRequest; readonly result: InseaRunResult } | null> {
  let captured: { request: InseaRunRequest; result: InseaRunResult } | null = null;
  let readCalls = 0;
  const runner: WorkflowRunner = async (request) => {
    if (stageOf(request) !== "read") return runInseaWorkflow(request);
    readCalls += 1;
    const result = await runInseaWorkflow(request);
    if (readCalls === options.unit) {
      captured = { request, result };
      throw new CaptureComplete();
    }
    return result;
  };
  try {
    await runReviewPipeline(
      { runner, config },
      { digest, ...(options.goal === "" ? {} : { goal: options.goal }) },
    );
  } catch (error) {
    if (!(error instanceof CaptureComplete)) {
      reportError(error);
      process.exit(1);
    }
  }
  return captured;
}

/** Phase 2: send the captured request and its variants, printing each result as it lands. */
async function measure(
  request: InseaRunRequest,
  variants: readonly PayloadVariant[],
  options: Options,
  token: string,
): Promise<Measurement[]> {
  const measurements: Measurement[] = [];
  console.log(`measuring ${variants.length} variant(s) x ${options.repeat} call(s):`);
  for (const variant of variants) {
    for (let run = 1; run <= options.repeat; run++) {
      const measured = applyPayloadVariant(request, variant);
      const accounting = payloadAccounting(
        measured.prompt,
        measured.manifestJson,
        measured.attachments,
      );
      let entry: Measurement;
      try {
        const result = await runInseaWorkflow(measured);
        entry = {
          variant: variant.name,
          run,
          bytes: accounting.payloadBytes,
          sections: accounting.payloadSections,
          latencyMs: result.latencyMs,
          salvage: result.salvage,
          error: null,
          note: tokenNote(variant, result, token),
        };
      } catch (error) {
        entry = {
          variant: variant.name,
          run,
          bytes: accounting.payloadBytes,
          sections: accounting.payloadSections,
          latencyMs: 0,
          salvage: "-",
          error: error instanceof AiError ? `${error.code}: ${error.message}` : String(error),
          note: null,
        };
      }
      measurements.push(entry);
      console.log(
        `  ${pad(entry.variant, 14)} ${pad(formatBytes(entry.bytes), 10)} ${pad(
          entry.error === null ? formatSeconds(entry.latencyMs) : entry.error,
          44,
        )}${entry.note ?? ""}`,
      );
    }
  }
  return measurements;
}

/** Print the summary: per-variant bytes versus latency, plus the slope the byte cuts depend on. */
function printReport(measurements: readonly Measurement[], token: string): void {
  const names = [...new Set(measurements.map((entry) => entry.variant))];
  const baseline = summarise(measurements, "full");
  console.log("");
  console.log("variant        calls  bytes      avg        max        Δbytes   Δlatency  salvage");
  for (const name of names) {
    const group = summarise(measurements, name);
    if (group === null) continue;
    const deltaBytes = baseline === null ? "-" : formatSignedBytes(group.bytes - baseline.bytes);
    const deltaLatency =
      baseline === null || baseline.latencyMs === 0
        ? "-"
        : formatSignedSeconds(group.latencyMs - baseline.latencyMs);
    console.log(
      `${pad(name, 14)} ${pad(String(group.calls), 6)} ${pad(formatBytes(group.bytes), 10)} ` +
        `${pad(formatSeconds(group.latencyMs), 10)} ${pad(formatSeconds(group.maxMs), 10)} ` +
        `${pad(deltaBytes, 8)} ${pad(deltaLatency, 9)} ${group.salvage}`,
    );
  }
  const floor = summarise(measurements, "essential");
  const padded = summarise(measurements, "padded-400k");
  if (floor !== null && padded !== null && padded.bytes > floor.bytes) {
    const seconds = (padded.latencyMs - floor.latencyMs) / 1000;
    const perHundredKb = (padded.bytes - floor.bytes) / (100 * 1024);
    console.log("");
    console.log(
      `slope: ${(seconds / perHundredKb).toFixed(2)} s per 100 KB between essential ` +
        `(${formatBytes(floor.bytes)} -> ${formatSeconds(floor.latencyMs)}) and padded ` +
        `(${formatBytes(padded.bytes)} -> ${formatSeconds(padded.latencyMs)}). The per-call floor is ` +
        "a separate term, so read this as marginal cost, not as a model of total latency.",
    );
  }
  if (measurements.some((entry) => entry.variant === "token-hunt")) {
    const hunt = measurements.find(
      (entry) => entry.variant === "token-hunt" && entry.error === null,
    );
    console.log(
      `token hunt: the model ${hunt?.note === "token read" ? "read the DataList content" : "did NOT read the DataList content"} (planted token ${token}).`,
    );
  }
  const ladder = measurements.filter((entry) => LADDER.some((step) => step.name === entry.variant));
  if (ladder.length > 0) {
    console.log("");
    console.log(
      `size ladder: ${ladder
        .map(
          (entry) =>
            `${entry.variant} ${formatBytes(entry.bytes)} ` +
            `${entry.error === null ? formatSeconds(entry.latencyMs) : "FAILED"}`,
        )
        .join(" · ")}`,
    );
  }
}

/** Per-variant aggregate over its successful calls. */
function summarise(
  measurements: readonly Measurement[],
  name: string,
): {
  readonly calls: number;
  readonly bytes: number;
  readonly latencyMs: number;
  readonly maxMs: number;
  readonly salvage: string;
} | null {
  const group = measurements.filter((entry) => entry.variant === name && entry.error === null);
  const first = group[0];
  if (first === undefined) return null;
  const latencies = group.map((entry) => entry.latencyMs);
  return {
    calls: group.length,
    bytes: first.bytes,
    latencyMs: Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
    maxMs: Math.max(...latencies),
    salvage: first.salvage,
  };
}

/** `"token read"` when the answer contains the token planted in the attached file. */
function tokenNote(variant: PayloadVariant, result: InseaRunResult, token: string): string | null {
  if (variant.prompt !== TOKEN_PROMPT) return null;
  return result.rawResult.includes(token) ? "token read" : "token missing";
}

/** `read` is the only stage the probe measures; every other call runs untouched. */
function stageOf(request: InseaRunRequest): string {
  try {
    const parsed = JSON.parse(request.manifestJson) as { readonly stage?: unknown };
    return typeof parsed.stage === "string" ? parsed.stage : "";
  } catch {
    return "";
  }
}

/** Load the digest for the pair under test from the local server (same call the review page makes). */
async function fetchDigest(options: Options): Promise<DigestBundle> {
  const serverUrl = process.env.SILENTSKIP_SERVER_URL ?? "http://127.0.0.1:3000";
  const url = `${serverUrl}/api/projects/${options.projectId}/digest?base=${encodeURIComponent(
    options.base,
  )}&current=${encodeURIComponent(options.current)}`;
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`digest fetch failed: HTTP ${response.status} (${url})`);
    process.exit(1);
  }
  return DigestBundleSchema.parse(await response.json());
}

/**
 * Probe timeout: the server's run budget bounded by the probe ceiling above, so one wedged call
 * cannot hold the probe for hours.
 */
function probeTimeoutMs(): number {
  const raw = process.env.AI_WORKFLOW_TIMEOUT_MS;
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return 180_000;
  return Math.min(parsed, PROBE_MAX_TIMEOUT_MS);
}

function reportError(error: unknown): void {
  if (error instanceof AiError) {
    console.error(
      JSON.stringify(
        { code: error.code, status: error.status, message: error.message, details: error.details },
        null,
        2,
      ),
    );
    return;
  }
  console.error(error);
}

function parseOptions(argv: readonly string[]): Options | null {
  const positional: string[] = [];
  let unit = 1;
  let repeat = 1;
  let goal = "";
  let variants: string[] | null = null;
  let contentCheck = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === undefined) return null;
    if (arg === "--unit") {
      const value = Number.parseInt(argv[++index] ?? "", 10);
      if (!Number.isInteger(value) || value < 0) return null;
      unit = value;
    } else if (arg === "--repeat") {
      const value = Number.parseInt(argv[++index] ?? "", 10);
      if (!Number.isInteger(value) || value < 1 || value > 10) return null;
      repeat = value;
    } else if (arg === "--goal") {
      goal = argv[++index] ?? "";
    } else if (arg === "--variants") {
      variants = (argv[++index] ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name !== "");
    } else if (arg === "--content-check") {
      contentCheck = true;
    } else if (arg.startsWith("--")) {
      return null;
    } else {
      positional.push(arg);
    }
  }
  const [projectId, base, current] = positional;
  if (unit > 0 && (projectId === undefined || base === undefined || current === undefined)) {
    return null;
  }
  return {
    projectId: projectId ?? "",
    base: base ?? "",
    current: current ?? "",
    unit,
    repeat,
    goal,
    variants,
    contentCheck,
  };
}

function formatSections(sections: readonly PassPayloadSection[]): string {
  return sections.map((section) => `${section.name} ${formatBytes(section.bytes)}`).join(" · ");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatSignedBytes(delta: number): string {
  return `${delta >= 0 ? "+" : "-"}${formatBytes(Math.abs(delta))}`;
}

function formatSeconds(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`;
}

function formatSignedSeconds(delta: number): string {
  return `${delta >= 0 ? "+" : "-"}${formatSeconds(Math.abs(delta))}`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

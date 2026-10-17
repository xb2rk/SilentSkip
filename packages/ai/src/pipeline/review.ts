import type { DigestBundle, ReviewLens, SynthesizeOutput } from "@craftland-qa/contracts";
import { buildReviewContext } from "../context/build.js";
import type { ReviewContextManifest } from "../context/types.js";
import { runInseaWorkflow } from "../insea/client.js";
import { runDigPass } from "../passes/dig.js";
import { runDigestReadPass } from "../passes/digest-read.js";
import { mergeReadOutputs, type StructuredFindings } from "../passes/digest-step.js";
import { runSynthesizePass } from "../passes/synthesize.js";
import type { PassConfig, PassMeta, WorkflowRunner } from "../passes/types.js";

/** Input of one review run — the digest plus the user's goal and lens. */
export interface ReviewPipelineInput {
  readonly digest: DigestBundle;
  readonly goal?: string;
  readonly lens?: ReviewLens;
  readonly signal?: AbortSignal;
}

/** Everything one review run produced, with honest per-pass metadata. */
export interface ReviewPipelineResult {
  readonly report: SynthesizeOutput;
  readonly structuredFindings: StructuredFindings;
  readonly passes: readonly PassMeta[];
  readonly contextManifest: ReviewContextManifest;
}

/** Dependencies of the review pipeline. */
export interface ReviewPipelineDeps {
  readonly runner: WorkflowRunner;
  readonly config: PassConfig;
}

/** Wire the real Insea transport — callers with tests inject a scripted runner instead. */
export function createReviewDeps(config: PassConfig): ReviewPipelineDeps {
  return { runner: runInseaWorkflow, config };
}

/**
 * The v1 review pipeline: `digest_read → [dig] → synthesize` (plan §5.2).
 *
 * `dig` runs at most once — only when pass 1 asks for more evidence, never recursively — and
 * the merge between passes is deterministic. The citation verifier (E4.3) will sit between the
 * merge and `synthesize`; until then the structured findings are returned for inspection.
 */
export async function runReviewPipeline(
  deps: ReviewPipelineDeps,
  input: ReviewPipelineInput,
): Promise<ReviewPipelineResult> {
  const context = buildReviewContext(input.digest, {
    ...(input.goal === undefined ? {} : { goal: input.goal }),
    ...(input.lens === undefined ? {} : { lens: input.lens }),
  });

  const read = await runDigestReadPass(deps, context, input.signal);
  const dig =
    read.output.needMore.length > 0
      ? await runDigPass(deps, context, read.output.needMore, input.signal)
      : undefined;
  const structured = mergeReadOutputs(read.output, dig?.output);
  const synthesize = await runSynthesizePass(deps, { context, structured }, input.signal);

  return {
    report: synthesize.output,
    structuredFindings: structured,
    passes: [read.meta, ...(dig === undefined ? [] : [dig.meta]), synthesize.meta],
    contextManifest: context.manifest,
  };
}

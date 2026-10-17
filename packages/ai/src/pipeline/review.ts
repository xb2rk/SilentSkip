import type { DigestBundle, ReviewLens, SynthesizeOutput } from "@craftland-qa/contracts";
import { buildReviewContext, evidenceAnchorsOf } from "../context/build.js";
import type { ReviewContextManifest } from "../context/types.js";
import { runInseaWorkflow } from "../insea/client.js";
import { runDigPass } from "../passes/dig.js";
import { runDigestReadPass } from "../passes/digest-read.js";
import { mergeReadOutputs, type StructuredFindings } from "../passes/digest-step.js";
import { runSynthesizePass } from "../passes/synthesize.js";
import type { PassConfig, PassMeta, WorkflowRunner } from "../passes/types.js";
import {
  type VerifyIssue,
  type VerifyStats,
  verifyFindings,
  verifySynthesizeReport,
} from "../verify/index.js";

/** Input of one review run — the digest plus the user's goal and lens. */
export interface ReviewPipelineInput {
  readonly digest: DigestBundle;
  readonly goal?: string;
  readonly lens?: ReviewLens;
  readonly signal?: AbortSignal;
}

/** Verifier outcome of one run — per-pass counts plus the combined audit trail. */
export interface PipelineVerification {
  readonly read: VerifyStats;
  readonly dig: VerifyStats | null;
  readonly synthesize: VerifyStats;
  readonly issues: readonly VerifyIssue[];
}

/** Everything one review run produced, with honest per-pass metadata and verifier counts. */
export interface ReviewPipelineResult {
  readonly report: SynthesizeOutput;
  readonly structuredFindings: StructuredFindings;
  readonly passes: readonly PassMeta[];
  readonly contextManifest: ReviewContextManifest;
  readonly verification: PipelineVerification;
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
 * the merge between passes is deterministic. The citation verifier sits on every pass boundary:
 * read/dig findings are verified before the merge, `synthesize` may only cite anchors that
 * survived, and its report is verified once more before it leaves the pipeline. Citations are
 * checked against the full digest anchor registry — the budgeted evidence pack is payload,
 * not authority.
 */
export async function runReviewPipeline(
  deps: ReviewPipelineDeps,
  input: ReviewPipelineInput,
): Promise<ReviewPipelineResult> {
  const context = buildReviewContext(input.digest, {
    ...(input.goal === undefined ? {} : { goal: input.goal }),
    ...(input.lens === undefined ? {} : { lens: input.lens }),
  });
  const authoritativeAnchors = evidenceAnchorsOf(input.digest);

  const read = await runDigestReadPass(deps, context, input.signal);
  const readVerified = verifyFindings(context, read.output.findings, {
    pass: "digest_read",
    allAnchors: authoritativeAnchors,
  });
  const dig =
    read.output.needMore.length > 0
      ? await runDigPass(deps, context, read.output.needMore, input.signal)
      : undefined;
  const digVerified =
    dig === undefined
      ? undefined
      : verifyFindings(context, dig.output.findings, {
          pass: "dig",
          allAnchors: authoritativeAnchors,
        });
  const structured = mergeReadOutputs(
    { ...read.output, findings: [...readVerified.findings] },
    digVerified === undefined || dig === undefined
      ? undefined
      : { ...dig.output, findings: [...digVerified.findings] },
  );
  const seenAnchors = new Set(structured.findings.flatMap((finding) => finding.anchors));
  const synthesize = await runSynthesizePass(deps, { context, structured }, input.signal);
  const verifiedReport = verifySynthesizeReport(
    context,
    synthesize.output,
    seenAnchors,
    authoritativeAnchors,
  );

  return {
    report: verifiedReport.report,
    structuredFindings: structured,
    passes: [read.meta, ...(dig === undefined ? [] : [dig.meta]), synthesize.meta],
    contextManifest: context.manifest,
    verification: {
      read: readVerified.stats,
      dig: digVerified?.stats ?? null,
      synthesize: verifiedReport.stats,
      issues: [...readVerified.issues, ...(digVerified?.issues ?? []), ...verifiedReport.issues],
    },
  };
}

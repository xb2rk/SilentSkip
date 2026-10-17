import { type DigestReadOutput, DigestReadOutputSchema } from "@craftland-qa/contracts";
import { buildPassManifestJson, serializeContextFiles } from "../context/build.js";
import type { ReviewContext } from "../context/types.js";
import { buildDigestReadPrompt, PROMPT_VERSIONS } from "../prompts/registry.js";
import { parsePassOutput } from "./parse-output.js";
import { buildRunRequest, type PassDeps, type PassMeta } from "./types.js";

/** Result of pass 1. */
export interface DigestReadPassResult {
  readonly output: DigestReadOutput;
  readonly meta: PassMeta;
}

/** Pass 1 — read the digest: findings, unknowns, negative results, ≤3 follow-up queries. */
export async function runDigestReadPass(
  deps: PassDeps,
  context: ReviewContext,
  signal?: AbortSignal,
): Promise<DigestReadPassResult> {
  const attachments = serializeContextFiles(context);
  const result = await deps.runner(
    buildRunRequest(
      deps,
      buildDigestReadPrompt(context),
      buildPassManifestJson("digest_read", context, attachments),
      attachments,
      signal,
    ),
  );
  return {
    output: parsePassOutput(DigestReadOutputSchema, result, "digest_read"),
    meta: {
      pass: "digest_read",
      promptVersion: PROMPT_VERSIONS.digestRead,
      latencyMs: result.latencyMs,
      salvage: result.salvage,
    },
  };
}

import { type SynthesizeOutput, SynthesizeOutputSchema } from "@craftland-qa/contracts";
import {
  buildPassManifestJson,
  serializeAnchorsJsonl,
  serializeTaskFile,
} from "../context/build.js";
import type { ReviewContext } from "../context/types.js";
import type { InseaAttachment } from "../insea/types.js";
import { buildSynthesizePrompt, PROMPT_VERSIONS } from "../prompts/registry.js";
import type { StructuredFindings } from "./digest-step.js";
import { parsePassOutput } from "./parse-output.js";
import { buildRunRequest, type PassDeps, type PassMeta } from "./types.js";

/** Input of the final writer pass. */
export interface SynthesizePassInput {
  readonly context: ReviewContext;
  readonly structured: StructuredFindings;
}

/** Result of the final writer pass. */
export interface SynthesizePassResult {
  readonly output: SynthesizeOutput;
  readonly meta: PassMeta;
}

/** Final writer — the report over structured findings; may not introduce new anchors. */
export async function runSynthesizePass(
  deps: PassDeps,
  input: SynthesizePassInput,
  signal?: AbortSignal,
): Promise<SynthesizePassResult> {
  const { context, structured } = input;
  const attachments: InseaAttachment[] = [
    serializeTaskFile(context),
    {
      uploadName: "findings.json",
      mimeType: "application/json",
      content: JSON.stringify(
        {
          findings: structured.findings,
          unknowns: structured.unknowns,
          negativeResults: structured.negativeResults,
          answers: structured.answers,
        },
        null,
        2,
      ),
    },
    {
      uploadName: "anchors.jsonl",
      mimeType: "application/x-ndjson",
      content: serializeAnchorsJsonl(context.evidence),
    },
  ];
  const result = await deps.runner(
    buildRunRequest(
      deps,
      buildSynthesizePrompt(context, structured.findings, structured.unknowns),
      buildPassManifestJson("synthesize", context, attachments),
      attachments,
      signal,
    ),
  );
  return {
    output: parsePassOutput(SynthesizeOutputSchema, result, "synthesize"),
    meta: {
      pass: "synthesize",
      promptVersion: PROMPT_VERSIONS.synthesize,
      latencyMs: result.latencyMs,
      salvage: result.salvage,
    },
  };
}

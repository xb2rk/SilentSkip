import { type SynthesizeOutput, SynthesizeOutputSchema } from "@silentskip/contracts";
import {
  buildPassManifestJson,
  serializeAnchorsJsonl,
  serializeTaskFile,
  serializeThemesFile,
} from "../context/build.js";
import type { ReviewContext } from "../context/types.js";
import type { InseaAttachment } from "../insea/types.js";
import { buildSynthesizePrompt, PROMPT_VERSIONS } from "../prompts/registry.js";
import type { StructuredFindings } from "./digest-step.js";
import { parsePassOutput } from "./parse-output.js";
import { type PassDeps, type PassMeta, runPassCall } from "./types.js";

/** Input of one writer call. */
export interface SynthesizePassInput {
  readonly context: ReviewContext;
  readonly structured: StructuredFindings;
  readonly themes: readonly {
    readonly id: string;
    readonly name: string;
    readonly files: readonly string[];
  }[];
  /** L3 constraints from the previous link round (empty on the first round). */
  readonly constraints: readonly string[];
  /** 1-based synthesize round. */
  readonly round: number;
}

/** Result of one writer call. */
export interface SynthesizePassResult {
  readonly output: SynthesizeOutput;
  readonly meta: PassMeta;
}

/**
 * Final writer — the report over linked findings. The pipeline re-runs it (L3, ≤2 rounds)
 * with linker issues as constraints; each call is a fresh single-shot workflow call.
 */
export async function runSynthesizePass(
  deps: PassDeps,
  input: SynthesizePassInput,
  signal?: AbortSignal,
): Promise<SynthesizePassResult> {
  const { context, structured, themes, constraints, round } = input;
  const attachments: InseaAttachment[] = [
    serializeTaskFile(context),
    {
      uploadName: "findings.json",
      mimeType: "application/json",
      content: JSON.stringify(structured, null, 2),
    },
    serializeThemesFile(themes),
    {
      uploadName: "anchors.jsonl",
      mimeType: "application/x-ndjson",
      content: serializeAnchorsJsonl(context.evidence),
    },
  ];
  const { result, meta } = await runPassCall(deps, {
    prompt: buildSynthesizePrompt(
      context,
      structured.findings.length,
      themes,
      structured.unknowns.length,
      constraints,
    ),
    manifestJson: buildPassManifestJson("synthesize", context, attachments),
    attachments,
    signal,
  });
  return {
    output: parsePassOutput(SynthesizeOutputSchema, result, "synthesize"),
    meta: {
      pass: "synthesize",
      promptVersion: PROMPT_VERSIONS.synthesize,
      salvage: result.salvage,
      round,
      ...meta,
    },
  };
}

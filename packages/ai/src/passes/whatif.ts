import { type WhatIfOutput, WhatIfOutputSchema } from "@silentskip/contracts";
import type { InseaAttachment } from "../insea/types.js";
import { buildWhatIfPrompt, PROMPT_VERSIONS } from "../prompts/registry.js";
import {
  serializePinsJsonl,
  serializeWhatIfAnchorsJsonl,
  serializeWhatIfFactsFile,
  serializeWhatIfHistoryFile,
  serializeWhatIfReportFile,
  serializeWhatIfTaskFile,
  type WhatIfContext,
} from "../whatif/context.js";
import { parsePassOutput } from "./parse-output.js";
import { type PassDeps, type PassMeta, runPassCall } from "./types.js";

/** Result of one What-If answer call. */
export interface WhatIfPassResult {
  readonly output: WhatIfOutput;
  readonly meta: PassMeta;
}

/**
 * Run the What-If chat pass: one question, one stateless Insea call over the reconstructed
 * context (fact store, evidence, pins, ledger, recent turns, optional latest report).
 */
export async function runWhatIfPass(
  deps: PassDeps,
  context: WhatIfContext,
  signal?: AbortSignal,
): Promise<WhatIfPassResult> {
  const prompt = buildWhatIfPrompt(context, context.question);
  const attachments: InseaAttachment[] = [
    serializeWhatIfTaskFile(context),
    serializeWhatIfFactsFile(context),
    serializeWhatIfAnchorsJsonl(context),
    serializeWhatIfHistoryFile(context),
    serializePinsJsonl(context.pins, context.anchorsById),
    ...(context.runSummary === null ? [] : [serializeWhatIfReportFile(context)]),
  ];
  const manifestJson = JSON.stringify({
    version: "1.0.0",
    stage: "whatif",
    baseRef: context.taskPack.baseRef,
    currentRef: context.taskPack.currentRef,
    files: attachments.map((item) => ({
      uploadName: item.uploadName,
      relativePath: item.uploadName,
      kind: item.uploadName === "facts.json" ? "summary" : "other",
      byteSize: Buffer.byteLength(item.content, "utf8"),
    })),
  });
  const { result, meta } = await runPassCall(deps, { prompt, manifestJson, attachments, signal });
  const output = parsePassOutput(WhatIfOutputSchema, result, "whatif");
  return {
    output,
    meta: {
      pass: "whatif",
      promptVersion: PROMPT_VERSIONS.whatif,
      salvage: result.salvage,
      ...meta,
    },
  };
}

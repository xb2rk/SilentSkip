import { type DigestFinding, type ReadOutput, ReadOutputSchema } from "@silentskip/contracts";
import {
  buildPassManifestJson,
  serializeAnchorsJsonl,
  serializeBodiesFile,
  serializeFactsFile,
  serializeSkeletonFile,
  serializeTaskFile,
  serializeUnitFile,
} from "../context/build.js";
import type { EvidenceAnchor, ReviewContext } from "../context/types.js";
import { buildReadPrompt, PROMPT_VERSIONS } from "../prompts/registry.js";
import { parsePassOutput } from "./parse-output.js";
import { buildRunRequest, type PassDeps, type PassMeta } from "./types.js";

/**
 * The `read` pass (E7.2) — one call per reading unit, for every unit on every run.
 *
 * This is what replaces single-shot digest reading: the full change set is read unit by unit
 * (variance between runs cannot hide a file), and L1 re-runs individual units with explicit
 * constraints when the engine still sees uninterpreted findings.
 */

/** One reading unit as the pass sees it. */
export interface ReadUnit {
  readonly index: number;
  readonly files: readonly string[];
  readonly payload: string;
}

/** Options of one read call. */
export interface ReadPassOptions {
  /** 1-based round: 1 is the full sweep, ≥2 is an L1 coverage re-read. */
  readonly round: number;
  /** L1 constraints: engine items this re-read must address or put into unknowns. */
  readonly constraints: readonly string[];
  /** Engine findings whose anchors touch this unit. */
  readonly relatedFindings: readonly DigestFinding[];
  /** Change-line snippets (with ids) for this unit's files — the grounding text. */
  readonly anchors: readonly EvidenceAnchor[];
  /** 1-based chunk of the unit when large units are read chunk by chunk (E7.5). */
  readonly chunk: number;
  /** Total chunks of this unit (1 for the common case). */
  readonly chunks: number;
}

/** Result of one read call. */
export interface ReadPassResult {
  readonly output: ReadOutput;
  readonly meta: PassMeta;
}

/** Runs one reading unit through the workflow and parses its output. */
export async function runReadPass(
  deps: PassDeps,
  context: ReviewContext,
  unit: ReadUnit,
  options: ReadPassOptions,
  signal?: AbortSignal,
): Promise<ReadPassResult> {
  const attachments = [
    serializeTaskFile(context),
    serializeUnitFile(unit),
    serializeFactsFile(context, unit.files, options.relatedFindings),
    serializeBodiesFile(context, unit.files),
    {
      uploadName: "anchors.jsonl",
      mimeType: "application/x-ndjson",
      content: serializeAnchorsJsonl(options.anchors),
    },
    serializeSkeletonFile(context),
  ];
  const result = await deps.runner(
    buildRunRequest(
      deps,
      buildReadPrompt(
        context,
        unit.index + 1,
        context.plan.units.length,
        options.round,
        options.constraints,
        options.chunks > 1 ? `chunk ${options.chunk} of ${options.chunks}` : undefined,
      ),
      buildPassManifestJson("read", context, attachments),
      attachments,
      signal,
    ),
  );
  return {
    output: parsePassOutput(ReadOutputSchema, result, "read"),
    meta: {
      pass: "read",
      promptVersion: PROMPT_VERSIONS.read,
      latencyMs: result.latencyMs,
      salvage: result.salvage,
      unit: unit.index + 1,
      chunk: options.chunk,
      chunks: options.chunks,
      round: options.round,
    },
  };
}

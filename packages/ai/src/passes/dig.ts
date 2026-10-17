import { type DigOutput, DigOutputSchema } from "@craftland-qa/contracts";
import {
  buildPassManifestJson,
  serializeAnchorsJsonl,
  serializeTaskFile,
} from "../context/build.js";
import type { EvidenceAnchor, ReviewContext } from "../context/types.js";
import type { InseaAttachment } from "../insea/types.js";
import { buildDigPrompt, PROMPT_VERSIONS } from "../prompts/registry.js";
import { parsePassOutput } from "./parse-output.js";
import { buildRunRequest, type PassDeps, type PassMeta } from "./types.js";

/** Cap of anchors sent to the focused follow-up — attention quality, recorded in the manifest. */
export const MAX_FOCUSED_ANCHORS = 40;

/** Result of server-side query resolution. */
export interface FocusedEvidence {
  readonly queries: readonly string[];
  readonly anchors: readonly EvidenceAnchor[];
  readonly matched: ReadonlyArray<{ query: string; anchorIds: readonly string[] }>;
}

/**
 * Resolve `needMore` queries to exact spans — deterministic, server-side, never a model call.
 * A query matches an anchor when its lowercase text appears in the anchor's snippet, file or
 * id. Anchors are collected in query order, deduplicated, capped at MAX_FOCUSED_ANCHORS.
 */
export function resolveNeedMore(
  context: ReviewContext,
  needMore: readonly string[],
): FocusedEvidence {
  const queries = needMore.map((query) => query.trim()).filter((query) => query !== "");
  const seen = new Set<string>();
  const anchors: EvidenceAnchor[] = [];
  const matched: { query: string; anchorIds: string[] }[] = [];
  for (const query of queries) {
    const term = query.toLowerCase();
    const anchorIds: string[] = [];
    for (const anchor of context.evidence) {
      if (anchors.length >= MAX_FOCUSED_ANCHORS) break;
      const haystack = `${anchor.id}\n${anchor.file}\n${anchor.snippet}`.toLowerCase();
      if (!haystack.includes(term)) continue;
      anchorIds.push(anchor.id);
      if (!seen.has(anchor.id)) {
        seen.add(anchor.id);
        anchors.push(anchor);
      }
    }
    matched.push({ query, anchorIds });
  }
  return { queries, anchors, matched };
}

/** Result of the focused follow-up. */
export interface DigPassResult {
  readonly output: DigOutput;
  readonly meta: PassMeta;
  readonly focused: FocusedEvidence;
}

/** Focused follow-up — answer pass 1's queries from resolved spans. One round, no recursion. */
export async function runDigPass(
  deps: PassDeps,
  context: ReviewContext,
  needMore: readonly string[],
  signal?: AbortSignal,
): Promise<DigPassResult> {
  const focused = resolveNeedMore(context, needMore);
  const attachments: InseaAttachment[] = [
    serializeTaskFile(context),
    {
      uploadName: "queries.json",
      mimeType: "application/json",
      content: JSON.stringify(focused.queries, null, 2),
    },
    {
      uploadName: "focus.jsonl",
      mimeType: "application/x-ndjson",
      content: serializeAnchorsJsonl(focused.anchors),
    },
  ];
  const result = await deps.runner(
    buildRunRequest(
      deps,
      buildDigPrompt(context, focused.queries, focused.anchors),
      buildPassManifestJson("dig", context, attachments),
      attachments,
      signal,
    ),
  );
  return {
    output: parsePassOutput(DigOutputSchema, result, "dig"),
    meta: {
      pass: "dig",
      promptVersion: PROMPT_VERSIONS.dig,
      latencyMs: result.latencyMs,
      salvage: result.salvage,
    },
    focused,
  };
}

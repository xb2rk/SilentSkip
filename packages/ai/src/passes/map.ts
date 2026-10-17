import { type MapOutput, MapOutputSchema } from "@craftland-qa/contracts";
import {
  buildPassManifestJson,
  serializeSkeletonFile,
  serializeTaskFile,
} from "../context/build.js";
import type { ReviewContext } from "../context/types.js";
import { buildMapPrompt, PROMPT_VERSIONS } from "../prompts/registry.js";
import { parsePassOutput } from "./parse-output.js";
import { buildRunRequest, type PassDeps, type PassMeta } from "./types.js";

/**
 * The `map` pass (E7.2, decision #28 mechanism d) — theme partition refinement.
 *
 * The engine derives a base partition mechanically (import graph + directories); the model may
 * only rename/merge/split it. `normalizeThemes` enforces the invariant that makes the mechanism
 * real: every changed file appears in exactly one theme, or the whole map is rejected.
 */

/** One engine-validated theme: stable id (path order) + presentation name + exact file set. */
export interface NormalizedTheme {
  readonly id: string;
  readonly name: string;
  readonly files: string[];
}

/** Normalization outcome — `{ error }` when the model's partition is not an exact cover. */
export type MapNormalization = { readonly themes: NormalizedTheme[] } | { readonly error: string };

/**
 * Validates and normalizes the map output: every changed file exactly once, no unknown files,
 * no duplicates. Themes are ordered by their first file and receive engine ids (`theme-1…`),
 * so ids are stable across runs regardless of the model's ordering.
 */
export function normalizeThemes(
  output: MapOutput,
  changePaths: readonly string[],
): MapNormalization {
  const wanted = new Set(changePaths);
  const seen = new Set<string>();
  for (const theme of output.themes) {
    for (const file of theme.files) {
      if (!wanted.has(file)) {
        return { error: `theme "${theme.name}" references a file that did not change: ${file}` };
      }
      if (seen.has(file)) return { error: `file appears in more than one theme: ${file}` };
      seen.add(file);
    }
  }
  for (const path of changePaths) {
    if (!seen.has(path)) return { error: `file not covered by any theme: ${path}` };
  }
  const themes = output.themes
    .map((theme) => ({
      name: theme.name.trim(),
      files: [...theme.files].sort(compareStrings),
    }))
    .sort((a, b) => compareStrings(a.files[0] ?? "", b.files[0] ?? ""))
    .map((theme, index) => ({ id: `theme-${index + 1}`, name: theme.name, files: theme.files }));
  return { themes };
}

/** Result of the map pass. */
export interface MapPassResult {
  readonly output: MapOutput;
  readonly meta: PassMeta;
}

/** The `map` pass — refines the engine partition into named themes (no findings). */
export async function runMapPass(
  deps: PassDeps,
  context: ReviewContext,
  signal?: AbortSignal,
): Promise<MapPassResult> {
  const attachments = [serializeTaskFile(context), serializeSkeletonFile(context)];
  const result = await deps.runner(
    buildRunRequest(
      deps,
      buildMapPrompt(context),
      buildPassManifestJson("map", context, attachments),
      attachments,
      signal,
    ),
  );
  return {
    output: parsePassOutput(MapOutputSchema, result, "map"),
    meta: {
      pass: "map",
      promptVersion: PROMPT_VERSIONS.map,
      latencyMs: result.latencyMs,
      salvage: result.salvage,
    },
  };
}

/** Code-unit string compare — deterministic across platforms and locales. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

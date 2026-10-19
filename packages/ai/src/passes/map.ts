import { type MapOutput, MapOutputSchema } from "@silentskip/contracts";
import {
  buildPassManifestJson,
  serializeSkeletonFile,
  serializeTaskFile,
} from "../context/build.js";
import type { ReviewContext } from "../context/types.js";
import { buildMapPrompt, PROMPT_VERSIONS } from "../prompts/registry.js";
import { parsePassOutput } from "./parse-output.js";
import { type PassDeps, type PassMeta, runPassCall } from "./types.js";

/**
 * The `map` pass (E7.2/E7.2.1, decision #28 mechanism d) — theme partition refinement.
 *
 * The engine derives a base partition mechanically (import graph + directories) and issues a
 * **file id** (`f1…fN`) for every changed file in `skeleton.json`; the model may only pick ids
 * and name/merge/split themes — it never writes a path, so it cannot invent directories
 * (`Assets/Scripts/CSV/…` on a project whose CSVs live elsewhere is mechanically impossible).
 * `normalizeThemes` resolves ids and enforces the invariant that makes the mechanism real:
 * every changed file exactly once, or the whole map is rejected.
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
 * Resolves model-chosen file ids against the engine's id table and validates the partition:
 * unknown ids, duplicates and missing coverage are rejected with a repairable message. Themes
 * are ordered by their first resolved path and receive engine ids (`theme-1…`), so theme ids
 * are stable across runs regardless of the model's ordering.
 */
export function normalizeThemes(
  output: MapOutput,
  idToPath: ReadonlyMap<string, string>,
): MapNormalization {
  const seen = new Set<string>();
  const resolved: { name: string; files: string[] }[] = [];
  for (const theme of output.themes) {
    const files: string[] = [];
    for (const token of theme.files) {
      const path = idToPath.get(token.trim());
      if (path === undefined) {
        return {
          error: `theme "${theme.name}" references an unknown file id: ${token.trim()} (ids are like f1…f${idToPath.size})`,
        };
      }
      if (seen.has(path)) {
        return { error: `file appears in more than one theme: ${path}` };
      }
      seen.add(path);
      files.push(path);
    }
    const name = theme.name.trim();
    if (name === "") {
      return { error: `theme "${theme.name}" has a blank name; give every theme a short label` };
    }
    resolved.push({ name, files: files.sort(compareStrings) });
  }
  for (const [id, path] of idToPath) {
    if (!seen.has(path)) {
      return { error: `file not covered by any theme: ${path} (id ${id})` };
    }
  }
  const themes = resolved
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
  constraints: readonly string[],
  signal?: AbortSignal,
): Promise<MapPassResult> {
  const attachments = [serializeTaskFile(context), serializeSkeletonFile(context)];
  const { result, meta } = await runPassCall(deps, {
    prompt: buildMapPrompt(context, constraints),
    manifestJson: buildPassManifestJson("map", context, attachments),
    attachments,
    signal,
  });
  return {
    output: parsePassOutput(MapOutputSchema, result, "map"),
    meta: { pass: "map", promptVersion: PROMPT_VERSIONS.map, salvage: result.salvage, ...meta },
  };
}

/** Code-unit string compare — deterministic across platforms and locales. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

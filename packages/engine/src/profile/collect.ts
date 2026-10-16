/**
 * Discovery candidate collector v1 — deterministic proposals for the future
 * AI pass (`discover_conventions`, E4).
 *
 * Candidates are *proposals for the user to review*, never authority: the
 * collector only surfaces things the engine already proved — CSV-naming string
 * literals (channel ①) and import paths with their importer files. No scoring,
 * no heuristics, no guessing; every candidate carries its evidence.
 */

import type { FactBundle, FactSpan } from "../facts/index.js";
import type { RelationSet } from "../relations/index.js";

/** One deterministic proposal for the Discovery pass. */
export interface DiscoveryCandidate {
  /** Stable id: `kind|file|offset` or `kind|path`. */
  readonly id: string;
  readonly kind: "csv-binding" | "import-path";
  /** File the evidence points at (first importer for import paths). */
  readonly file: string;
  /** Raw-faithful span when the candidate is positional (csv-binding). */
  readonly span?: FactSpan;
  /** Why this candidate exists — human-readable, ordered. */
  readonly evidence: readonly string[];
}

/**
 * Collects discovery candidates from proven facts and relations.
 *
 * @param bundle - Fact bundle of the indexed snapshot.
 * @param relations - Relations built from the same bundle.
 */
export function collectDiscoveryCandidates(
  bundle: FactBundle,
  relations: RelationSet,
): DiscoveryCandidate[] {
  const candidates: DiscoveryCandidate[] = [];

  for (const relation of relations.relations) {
    if (relation.ruleId !== "string-names-csv") continue;
    candidates.push({
      id: `csv-binding|${relation.from.file}|${relation.from.span?.offset ?? -1}`,
      kind: "csv-binding",
      file: relation.from.file,
      ...(relation.from.span === undefined ? {} : { span: relation.from.span }),
      evidence: [...relation.derivation, `names ${relation.to.file}`],
    });
  }

  const importFiles = new Map<string, string[]>();
  for (const file of bundle.files) {
    for (const imp of file.imports) {
      const list = importFiles.get(imp.path);
      if (list === undefined) importFiles.set(imp.path, [file.path]);
      else if (!list.includes(file.path)) list.push(file.path);
    }
  }
  for (const path of [...importFiles.keys()].sort()) {
    const files = [...(importFiles.get(path) ?? [])].sort();
    const first = files[0];
    if (first === undefined) continue;
    candidates.push({
      id: `import-path|${path}`,
      kind: "import-path",
      file: first,
      evidence: [`imported by ${files.length} file(s)`, ...files.slice(0, 3)],
    });
  }

  return candidates.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

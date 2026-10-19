import type { Anchor } from "@silentskip/contracts";
import type { EvidenceAnchor } from "../context/types.js";
import { compareStrings } from "../text/compare.js";

/** The slice of a reading unit that coverage targeting needs. */
export interface CoverageUnit {
  /** Zero-based position in the reading plan; also the order the units are read in. */
  readonly index: number;
  /** Files the unit covers, as the digest's plan lists them. */
  readonly files: readonly string[];
}

export interface CoverageTargetInput<T extends CoverageUnit> {
  readonly units: readonly T[];
  /** Units whose calls never answered: timeout, dead transport, or output that failed to parse. */
  readonly retryUnits: ReadonlySet<number>;
}

/**
 * Picks the units worth a second reading pass in the L1 coverage round, in unit order: only units
 * whose reading never arrived (timeout, dead transport, unparsable output) qualify — a unit with no
 * reading at all is worse than an expensive one.
 *
 * Engine findings are NOT a re-read trigger any more: they are deterministic facts the engine has
 * already proven, they travel straight to `synthesize` as `engine-findings.jsonl`, and linkReport
 * accepts their anchors as seen. Spending a whole extra reading round so the model repeats a
 * finding the engine already reports (real run: two units, ~3.5 minutes of call time) bought
 * nothing the report did not already have.
 */
export function selectCoverageTargets<T extends CoverageUnit>(
  input: CoverageTargetInput<T>,
): readonly T[] {
  return input.units
    .filter((unit) => input.retryUnits.has(unit.index))
    .sort((left, right) => left.index - right.index);
}

/** Upper bound of snippet anchors shipped to one read call (grounding text per unit). */
const MAX_UNIT_ANCHORS = 300;

/** Per-file cap inside one read call — every file keeps representation (E7.5 balance). */
const MAX_ANCHORS_PER_FILE = 40;

/**
 * Balanced unit anchors (E7.5): group by file, keep evidence-pack anchors first per file, cap
 * `MAX_ANCHORS_PER_FILE` per file and interleave files round-robin under `MAX_UNIT_ANCHORS` —
 * one noisy file (localization tables say) can no longer starve every other file of context.
 */
export function selectUnitAnchors(
  anchors: readonly Anchor[],
  evidenceIds: ReadonlySet<string>,
): EvidenceAnchor[] {
  const byFile = new Map<string, Anchor[]>();
  for (const anchor of anchors) {
    const list = byFile.get(anchor.file);
    if (list === undefined) byFile.set(anchor.file, [anchor]);
    else list.push(anchor);
  }
  const files = [...byFile.keys()].sort(compareStrings);
  const queues = files.map((file) => {
    const list = byFile.get(file) ?? [];
    return list
      .sort(
        (a, b) =>
          Number(evidenceIds.has(b.id)) - Number(evidenceIds.has(a.id)) ||
          a.lineStart - b.lineStart ||
          compareStrings(a.id, b.id),
      )
      .slice(0, MAX_ANCHORS_PER_FILE);
  });
  const cursors = queues.map(() => 0);
  const selected: EvidenceAnchor[] = [];
  let progressed = true;
  while (progressed && selected.length < MAX_UNIT_ANCHORS) {
    progressed = false;
    for (let index = 0; index < queues.length; index++) {
      const queue = queues[index];
      const cursor = cursors[index];
      if (queue === undefined || cursor === undefined) continue;
      const next = queue[cursor];
      if (next === undefined) continue;
      cursors[index] = cursor + 1;
      selected.push({
        id: next.id,
        ref: next.ref,
        file: next.file,
        lineStart: next.lineStart,
        lineEnd: next.lineEnd,
        kind: next.kind,
        snippet: next.snippet,
      });
      progressed = true;
      if (selected.length >= MAX_UNIT_ANCHORS) break;
    }
  }
  return selected;
}

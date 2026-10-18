import type { DigestBundle, DigestFinding } from "@silentskip/contracts";
import type { InseaAttachment } from "../insea/types.js";
import {
  CONTEXT_BUDGETS,
  type EvidenceAnchor,
  type ReviewContext,
  type ReviewContextInput,
} from "./types.js";

/**
 * Map every digest anchor to its evidence form — the authoritative registry the linker checks
 * citations against. The context's evidence pack is a budgeted slice of this same list.
 */
export function evidenceAnchorsOf(digest: DigestBundle): EvidenceAnchor[] {
  return digest.anchors.map((anchor) => ({
    id: anchor.id,
    ref: anchor.ref,
    file: anchor.file,
    lineStart: anchor.lineStart,
    lineEnd: anchor.lineEnd,
    kind: anchor.kind,
    snippet: anchor.snippet,
  }));
}

/**
 * Assemble the context of a review run from a digest.
 *
 * Deterministic: the evidence pack is selected by priority tiers with a round-robin spread across
 * files — changed values first (symbols and CSV cells), then row structure, removals, additions,
 * linked journeys, context items and finally every remaining anchor. The spread stops one noisy
 * file from eating the pack. Budgets (count, then bytes) drop from the tail and record honest
 * counts in the manifest. The pack is attention economy only — the linker checks citations
 * against the full anchor registry (and the fact store), so a cited anchor outside the pack
 * stays valid.
 * No clocks, no environment reads — the same digest always produces the same context.
 */
export function buildReviewContext(
  digest: DigestBundle,
  input: ReviewContextInput = {},
): ReviewContext {
  const allEvidence = evidenceAnchorsOf(digest);

  const priorities = collectAnchorPriorities(digest);
  const referencedIds = new Set(priorities.keys());

  const notes: string[] = [];
  const selected = selectEvidence(allEvidence, priorities, CONTEXT_BUDGETS.maxEvidenceAnchors);
  let evidence = selected;
  while (
    evidence.length > 0 &&
    Buffer.byteLength(serializeAnchorsJsonl(evidence), "utf8") > CONTEXT_BUDGETS.maxEvidenceBytes
  ) {
    evidence = evidence.slice(0, evidence.length - 1);
  }
  const dropped = allEvidence.length - evidence.length;
  if (dropped > 0) {
    const droppedByBytes = selected.length - evidence.length;
    notes.push(
      `evidence anchors dropped: ${dropped} (by count: ${dropped - droppedByBytes}, by bytes: ${droppedByBytes})`,
    );
  }
  const keptIds = new Set(evidence.map((anchor) => anchor.id));
  const referencedDropped = allEvidence.filter(
    (anchor) => referencedIds.has(anchor.id) && !keptIds.has(anchor.id),
  ).length;
  if (referencedDropped > 0) {
    notes.push(`referenced anchors dropped by budget: ${referencedDropped}`);
  }
  notes.push(
    `reading plan: ${digest.plan.units.length} unit(s) over ${digest.plan.skeleton.files.length} changed file(s)`,
  );
  notes.push(`engine findings: ${digest.findings.length}`);

  return {
    taskPack: {
      baseRef: digest.refs.base.ref,
      currentRef: digest.refs.current.ref,
      baseCommit: digest.refs.base.commitHash,
      currentCommit: digest.refs.current.commitHash,
      stats: digest.stats,
      goal: (input.goal ?? "").trim(),
      lens: input.lens ?? "both",
    },
    changeFacts: digest.changeFacts,
    linked: digest.linked,
    contextItems: digest.context,
    evidence,
    plan: digest.plan,
    quantities: digest.quantities,
    engineFindings: digest.findings,
    bodies: digest.bodies,
    manifest: {
      counts: {
        changeFacts: digest.changeFacts.length,
        linked: digest.linked.length,
        contextItems: digest.context.length,
        evidence: evidence.length,
        evidenceDropped: dropped,
      },
      notes,
    },
  };
}

/** Serialize anchors as JSON lines — the `anchors.jsonl` attachment format. */
export function serializeAnchorsJsonl(anchors: readonly EvidenceAnchor[]): string {
  return anchors.map((anchor) => JSON.stringify(anchor)).join("\n");
}

/** Serialize the task pack as `task.json` — shared by every pass. */
export function serializeTaskFile(context: ReviewContext): InseaAttachment {
  const { taskPack } = context;
  return attachment(
    "task.json",
    "application/json",
    JSON.stringify(
      {
        refs: {
          base: { ref: taskPack.baseRef, commitHash: taskPack.baseCommit },
          current: { ref: taskPack.currentRef, commitHash: taskPack.currentCommit },
        },
        stats: taskPack.stats,
        goal: taskPack.goal,
        lens: taskPack.lens,
      },
      null,
      2,
    ),
  );
}

/** Serialize the standard context files for the `dig`/`synthesize` passes. */
export function serializeContextFiles(context: ReviewContext): InseaAttachment[] {
  return [
    serializeTaskFile(context),
    attachment("changes.json", "application/json", JSON.stringify(context.changeFacts, null, 2)),
    attachment("journeys.json", "application/json", JSON.stringify(context.linked, null, 2)),
    attachment("context.json", "application/json", JSON.stringify(context.contextItems, null, 2)),
    attachment("anchors.jsonl", "application/x-ndjson", serializeAnchorsJsonl(context.evidence)),
  ];
}

/**
 * File ids for the map pass: `f1…fN` over the skeleton's file list (stable for the same digest).
 * The model selects these ids; the engine resolves them back to paths — model output can never
 * introduce a path of its own (E7.2.1).
 */
export interface ChangeFileIds {
  readonly idToPath: ReadonlyMap<string, string>;
  readonly pathToId: ReadonlyMap<string, string>;
}

/** Builds the file-id table of a context (input to `serializeSkeletonFile` + map normalization). */
export function changeFileIds(context: ReviewContext): ChangeFileIds {
  const idToPath = new Map<string, string>();
  const pathToId = new Map<string, string>();
  context.plan.skeleton.files.forEach((file, index) => {
    const id = `f${index + 1}`;
    idToPath.set(id, file.path);
    pathToId.set(file.path, id);
  });
  return { idToPath, pathToId };
}

/**
 * Serialize the change map as `skeleton.json` — every changed file (with its engine-issued id),
 * the import edges among them, the engine's base partition and the engine findings
 * (map/read passes read this).
 */
export function serializeSkeletonFile(context: ReviewContext): InseaAttachment {
  const ids = changeFileIds(context);
  return attachment(
    "skeleton.json",
    "application/json",
    JSON.stringify(
      {
        stats: context.taskPack.stats,
        files: context.plan.skeleton.files.map((file) => ({
          id: ids.pathToId.get(file.path) ?? "",
          ...file,
        })),
        importEdges: context.plan.skeleton.importEdges,
        basePartition: context.plan.partition.clusters,
        engineFindings: context.engineFindings,
      },
      null,
      2,
    ),
  );
}

/** Serialize one reading unit as `unit.json` — the payload a `read` pass works on. */
export function serializeUnitFile(unit: {
  readonly index: number;
  readonly files: readonly string[];
  readonly payload: string;
}): InseaAttachment {
  return attachment(
    "unit.json",
    "application/json",
    JSON.stringify(
      {
        index: unit.index,
        files: unit.files,
        entries: JSON.parse(unit.payload) as unknown,
      },
      null,
      2,
    ),
  );
}

/** Serialize the fact store slice for one reading unit: quantities + relevant engine findings. */
export function serializeFactsFile(
  context: ReviewContext,
  files: readonly string[],
  findings: readonly DigestFinding[],
): InseaAttachment {
  const fileSet = new Set(files);
  return attachment(
    "facts.json",
    "application/json",
    JSON.stringify(
      {
        quantities: context.quantities.filter((quantity) => fileSet.has(quantity.file)),
        engineFindings: findings,
      },
      null,
      2,
    ),
  );
}

/**
 * Serialize function bodies of the given files as `bodies.jsonl` (E7.5) — the material that
 * lets `read` explain what added/changed code does now instead of only naming symbols.
 */
export function serializeBodiesFile(
  context: ReviewContext,
  files: readonly string[],
): InseaAttachment {
  const fileSet = new Set(files);
  const lines = context.bodies
    .filter((body) => fileSet.has(body.file))
    .map((body) => JSON.stringify(body));
  return attachment("bodies.jsonl", "application/x-ndjson", lines.join("\n"));
}

/** Serialize the refined theme partition as `themes.json` (synthesize pass). */
export function serializeThemesFile(
  themes: readonly {
    readonly id: string;
    readonly name: string;
    readonly files: readonly string[];
  }[],
): InseaAttachment {
  return attachment("themes.json", "application/json", JSON.stringify(themes, null, 2));
}

/** Build the Insea `Manifest` field — exactly what was sent, with real byte sizes. */
export function buildPassManifestJson(
  stage: string,
  context: ReviewContext,
  attachments: readonly InseaAttachment[],
): string {
  return JSON.stringify({
    version: "1.0.0",
    stage,
    goal: context.taskPack.goal,
    lens: context.taskPack.lens,
    baseRef: context.taskPack.baseRef,
    currentRef: context.taskPack.currentRef,
    files: attachments.map((item) => ({
      uploadName: item.uploadName,
      relativePath: item.uploadName,
      kind: manifestKind(item.uploadName),
      byteSize: Buffer.byteLength(item.content, "utf8"),
    })),
  });
}

function attachment(uploadName: string, mimeType: string, content: string): InseaAttachment {
  return { uploadName, content, mimeType };
}

function manifestKind(uploadName: string): "code" | "csv" | "diff" | "summary" | "other" {
  if (uploadName === "changes.json") return "diff";
  if (uploadName === "task.json" || uploadName === "skeleton.json") return "summary";
  return "other";
}

/** Priority tiers for the evidence pack — lower tiers are the anchors the model most needs. */
const TIER_CHANGED = 0;
const TIER_ROW_STRUCTURE = 1;
const TIER_REMOVED = 2;
const TIER_ADDED = 3;
const TIER_LINKED = 4;
const TIER_CONTEXT = 5;
const TIER_UNREFERENCED = 6;

/**
 * Priority tier per anchor id, derived from the digest's own payloads. Anchors referenced by
 * multiple structures keep their lowest (most important) tier. Ids absent from the map are
 * unreferenced and fill the pack last.
 */
export function collectAnchorPriorities(digest: DigestBundle): Map<string, number> {
  const priorities = new Map<string, number>();
  const add = (id: string | null, tier: number): void => {
    if (id === null) return;
    const existing = priorities.get(id);
    if (existing === undefined || tier < existing) priorities.set(id, tier);
  };
  for (const fact of digest.changeFacts) {
    if (fact.kind === "script") {
      for (const change of fact.symbolsChanged) {
        add(change.beforeAnchorId, TIER_CHANGED);
        add(change.afterAnchorId, TIER_CHANGED);
      }
      for (const ref of fact.symbolsRemoved) add(ref.anchorId, TIER_REMOVED);
      for (const ref of fact.symbolsAdded) add(ref.anchorId, TIER_ADDED);
    } else {
      for (const row of fact.rowsChanged) {
        for (const cell of row.columnsChanged) {
          add(cell.beforeAnchorId, TIER_CHANGED);
          add(cell.afterAnchorId, TIER_CHANGED);
        }
      }
      for (const row of [...fact.rowsAdded, ...fact.rowsRemoved]) {
        add(row.anchorId, TIER_ROW_STRUCTURE);
      }
    }
  }
  for (const item of digest.linked) {
    add(item.anchorId, TIER_LINKED);
    for (const chain of item.chains) {
      for (const node of chain.nodes) add(node.anchorId, TIER_LINKED);
    }
  }
  for (const item of digest.context) add(item.anchorId, TIER_CONTEXT);
  return priorities;
}

/**
 * Select the evidence pack under the count budget: tier-major priority with a round-robin spread
 * across files inside each tier — one noisy file cannot eat the whole pack, and the anchors with
 * the most signal (changed values) survive first. Deterministic.
 */
export function selectEvidence(
  anchors: readonly EvidenceAnchor[],
  priorities: ReadonlyMap<string, number>,
  budget: number,
): EvidenceAnchor[] {
  const byFile = new Map<string, EvidenceAnchor[]>();
  for (const anchor of anchors) {
    const list = byFile.get(anchor.file);
    if (list === undefined) byFile.set(anchor.file, [anchor]);
    else list.push(anchor);
  }
  const files = [...byFile.keys()].sort(compareStrings);
  for (const file of files) {
    byFile
      .get(file)
      ?.sort(
        (a, b) =>
          (priorities.get(a.id) ?? TIER_UNREFERENCED) -
            (priorities.get(b.id) ?? TIER_UNREFERENCED) ||
          a.lineStart - b.lineStart ||
          compareStrings(a.id, b.id),
      );
  }
  const selected: EvidenceAnchor[] = [];
  // Pinned anchors can sit below the standard tiers (what-if context boosts them to `-1`),
  // so the sweep starts at the lowest tier actually present.
  const lowestTier = [...priorities.values()].reduce((min, tier) => Math.min(min, tier), 0);
  for (let tier = lowestTier; tier <= TIER_UNREFERENCED; tier++) {
    const queues = files.map(
      (file) =>
        byFile
          .get(file)
          ?.filter((anchor) => (priorities.get(anchor.id) ?? TIER_UNREFERENCED) === tier) ?? [],
    );
    const cursors = queues.map(() => 0);
    let progressed = true;
    while (progressed && selected.length < budget) {
      progressed = false;
      for (let index = 0; index < queues.length; index++) {
        const queue = queues[index];
        const cursor = cursors[index];
        if (queue === undefined || cursor === undefined) continue;
        const next = queue[cursor];
        if (next === undefined) continue;
        cursors[index] = cursor + 1;
        selected.push(next);
        progressed = true;
        if (selected.length >= budget) break;
      }
    }
    if (selected.length >= budget) break;
  }
  return selected;
}

/** Code-unit string compare — deterministic across platforms and locales. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

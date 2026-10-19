import type {
  Anchor,
  DigestBundle,
  DigestUnit,
  ReadFinding,
  ReviewLens,
  SynthesizeOutput,
} from "@silentskip/contracts";
import { buildReviewContext, changeFileIds, evidenceAnchorsOf } from "../context/build.js";
import type { EvidenceAnchor, ReviewContextManifest } from "../context/types.js";
import { AiError } from "../errors.js";
import { buildFactIndex, evaluateClaim, type FactIndex } from "../facts/fact-index.js";
import { buildPartialReport } from "../fallback.js";
import { runInseaWorkflow } from "../insea/client.js";
import type { InseaSalvage } from "../insea/types.js";
import {
  addLinkStats,
  emptyLinkStats,
  type LinkIssue,
  type LinkIssueKind,
  type LinkStats,
  linkFindings,
  linkReport,
} from "../link/index.js";
import { type DigPassResult, runDigPass } from "../passes/dig.js";
import { mergeStructured, type StructuredFindings } from "../passes/digest-step.js";
import { type NormalizedTheme, normalizeThemes, runMapPass } from "../passes/map.js";
import { type ReadPassResult, runReadPass } from "../passes/read.js";
import { runSynthesizePass, type SynthesizePassResult } from "../passes/synthesize.js";
import type { PassConfig, PassMeta, WorkflowRunner } from "../passes/types.js";

/** Coverage loop bound: after this many reading rounds the rest is reported, not chased. */
export const MAX_COVERAGE_ROUNDS = 2;

/**
 * L1 re-read bound (Phase 7): units that own an uninterpreted engine finding get at most this many
 * extra readings per round. Units whose calls never answered are exempt (see
 * `selectCoverageTargets`), because skipping one would leave it with no reading at all. Findings
 * left uninterpreted past the cap are not lost — they are reported as unknowns.
 */
export const MAX_COVERAGE_UNITS = 2;

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
  /** Engine findings no reading has cited yet; `anchors` are digest anchor ids. */
  readonly unaddressed: readonly { readonly anchors: readonly string[] }[];
  /** Anchor id → owning file, the digest's authoritative mapping. */
  readonly anchorFiles: ReadonlyMap<string, string>;
}

/**
 * Picks the units worth a second reading pass in the L1 coverage round, in unit order.
 *
 * Two sources qualify:
 * 1. `retryUnits` — the reading never arrived, so the unit is read again whatever the budget says;
 *    a unit with no reading at all is worse than an expensive one.
 * 2. Units owning an unaddressed engine finding — the engine has already proven a defect there and
 *    only the model can explain it. Capped to `MAX_COVERAGE_UNITS`, worst case first (most
 *    unaddressed findings, then lowest index), because L1 is the most expensive stretch of a run
 *    and whatever is left still surfaces honestly as an unknown.
 *
 * A unit that answered with nothing to report is deliberately not a target: it saw the same payload
 * and had nothing to say, so an identical second pass is the least likely of all to pay off.
 */
export function selectCoverageTargets<T extends CoverageUnit>(
  input: CoverageTargetInput<T>,
): readonly T[] {
  const retries = input.units.filter((unit) => input.retryUnits.has(unit.index));
  const retried = new Set(retries.map((unit) => unit.index));
  const owning = input.units
    .map((unit) => ({
      unit,
      owned: countOwnedFindings(unit, input.unaddressed, input.anchorFiles),
    }))
    .filter((entry) => entry.owned > 0 && !retried.has(entry.unit.index))
    .sort((left, right) => right.owned - left.owned || left.unit.index - right.unit.index)
    .slice(0, MAX_COVERAGE_UNITS)
    .map((entry) => entry.unit);
  return [...retries, ...owning].sort((left, right) => left.index - right.index);
}

/** Counts the unaddressed engine findings whose anchors live in this unit's files. */
function countOwnedFindings(
  unit: CoverageUnit,
  unaddressed: readonly { readonly anchors: readonly string[] }[],
  anchorFiles: ReadonlyMap<string, string>,
): number {
  const files = new Set(unit.files);
  return unaddressed.filter((finding) =>
    finding.anchors.some((anchorId) => files.has(anchorFiles.get(anchorId) ?? "")),
  ).length;
}

/** Map loop bound: map re-runs with repair constraints; then the engine partition takes over. */
export const MAX_MAP_ROUNDS = 2;

/** Revise loop bound: synthesize is re-run at most this many times with linker constraints. */
export const MAX_SYNTHESIZE_ROUNDS = 2;

/**
 * L3 rewrite trigger (Phase 6): a second synthesize round costs a whole extra call, so it only
 * runs when an issue means the report is **substantively wrong** — a finding lost its evidence, a
 * claim the engine proved false, a narrative pointing at a theme that does not exist. Cosmetic
 * strips (a free number, an unverified quote, an unknown fact) are accepted as-is; every strip is
 * already recorded in the audit trail, so nothing is hidden by not rewriting.
 */
export const BLOCKING_SYNTHESIZE_ISSUE_KINDS: ReadonlySet<LinkIssueKind> = new Set<LinkIssueKind>([
  "finding-unanchored",
  "new-anchor",
  "claim-invalid",
  "claim-false",
  "theme-invalid",
]);

/**
 * A pass failure that degrades the run instead of killing it (Phase 1 / E4).
 *
 * `invalid-output` keeps its own repair path at every pass; `cancelled` must always propagate so
 * the server can persist the run as cancelled; anything else is an `AiError` (timeout, network,
 * http) and the run continues with whatever it already produced.
 */
function degradableError(error: unknown): AiError | null {
  if (!(error instanceof AiError)) return null;
  if (error.code === "invalid-output" || error.code === "cancelled") return null;
  return error;
}

/** Issue kind of a degraded pass — `timeout` and everything else are distinguished for the UI. */
function degradedIssueKind(
  pass: "map" | "read" | "dig" | "synthesize",
  code: AiError["code"],
): LinkIssueKind {
  return `${pass}-${code === "timeout" ? "timeout" : "unavailable"}`;
}

/** How many constraints/issues are handed back to a re-run (attention quality). */
const MAX_CONSTRAINT_LINES = 10;

/** Upper bound of snippet anchors shipped to one read call (grounding text per unit). */
const MAX_UNIT_ANCHORS = 300;

/** Per-file cap inside one read call — every file keeps representation (E7.5 balance). */
const MAX_ANCHORS_PER_FILE = 40;

/**
 * Byte budget of one read call's material (compact entries + function bodies) — a bound on the call
 * payload, not a preference: units above it are read chunk by chunk (E7.5, nothing dropped).
 *
 * Only the unit material is budgeted, so the payload a read call sends is roughly
 * `budget + ~105 KB` (skeleton of every changed file + facts + anchors + prompt + manifest). Insea
 * carried 419 KB and 390 KB payloads and rejected a merged chunk whose material alone was 146 KB
 * (~480 KB by that ratio; plan §7), so the sum has to stay well under ~400 KB. At 90_000 this 72-file
 * digest split three units, and three of the six chunk calls it produced cost 30-53 s for 4-33 KB of
 * material — a call has a floor, so splitting is the expensive way to stay small. At 200_000 every
 * unit of the digest goes in one call (largest material: 179 KB) and the payload stays ~285 KB.
 */
const READ_CHUNK_BUDGET_BYTES = 200_000;

/** One attention slice of a reading unit — a chunk is one `read` call. */
interface ReadChunk {
  readonly index: number;
  readonly files: readonly string[];
  readonly payload: string;
}

/**
 * Split a reading unit's material into read-call chunks of ~`budget` bytes. Files keep the unit's
 * order; a single oversized file goes into a chunk alone. The material stays lossless: chunks are
 * sequential read calls, not a sampling of the unit.
 */
function chunkReadingUnit(
  unit: DigestUnit,
  bodyBytesByFile: ReadonlyMap<string, number>,
  budget: number,
): ReadChunk[] {
  const entries = JSON.parse(unit.payload) as { path?: unknown }[];
  const byPath = new Map<string, unknown[]>();
  const order: string[] = [];
  for (const entry of entries) {
    const path = typeof entry.path === "string" ? entry.path : "";
    const list = byPath.get(path);
    if (list === undefined) {
      byPath.set(path, [entry]);
      order.push(path);
    } else {
      list.push(entry);
    }
  }
  if (order.length <= 1) {
    return [{ index: 0, files: [...unit.files], payload: unit.payload }];
  }
  const weightOf = (path: string): number =>
    JSON.stringify(byPath.get(path) ?? []).length + (bodyBytesByFile.get(path) ?? 0);
  const serialize = (files: readonly string[]): string =>
    JSON.stringify(files.flatMap((file) => byPath.get(file) ?? []));
  const chunks: ReadChunk[] = [];
  let current: string[] = [];
  let currentBytes = 0;
  for (const path of order) {
    const weight = weightOf(path);
    if (current.length > 0 && currentBytes + weight > budget) {
      chunks.push({ index: chunks.length, files: current, payload: serialize(current) });
      current = [];
      currentBytes = 0;
    }
    current.push(path);
    currentBytes += weight;
  }
  if (current.length > 0) {
    chunks.push({ index: chunks.length, files: current, payload: serialize(current) });
  }
  return chunks;
}

/**
 * Balanced unit anchors (E7.5): group by file, keep evidence-pack anchors first per file, cap
 * `MAX_ANCHORS_PER_FILE` per file and interleave files round-robin under `MAX_UNIT_ANCHORS` —
 * one noisy file (localization tables say) can no longer starve every other file of context.
 */
function selectUnitAnchors(
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

/** Progress event of one pipeline stage — what the server relays over SSE. */
export interface PipelineStageEvent {
  readonly stage: "map" | "read" | "dig" | "synthesize";
  readonly state: "started" | "completed";
  readonly latencyMs?: number;
  readonly salvage?: InseaSalvage;
  /** 1-based reading-unit index, present on `read` events. */
  readonly unit?: number;
  /** Total reading units, present on `read` events. */
  readonly units?: number;
  /** 1-based chunk inside the unit and the unit's total chunks (E7.5). */
  readonly chunk?: number;
  readonly chunks?: number;
  /** 1-based loop round when L1/L3 re-runs a pass. */
  readonly round?: number;
}

/** Everything a partially finished run has produced — a `ReviewPipelineResult` without `report`. */
export interface PipelineCheckpoint {
  readonly themes: readonly NormalizedTheme[];
  readonly structured: StructuredFindings;
  readonly passes: readonly PassMeta[];
  readonly verification: PipelineVerification;
  readonly contextManifest: ReviewContextManifest;
}

/** Input of one review run — the digest plus the user's goal and lens. */
export interface ReviewPipelineInput {
  readonly digest: DigestBundle;
  readonly goal?: string;
  readonly lens?: ReviewLens;
  readonly signal?: AbortSignal;
  /** Optional progress hook — called around every pass, never inside the linker. */
  readonly onEvent?: (event: PipelineStageEvent) => void | Promise<void>;
  /**
   * Optional checkpoint hook (A4b) — called after `map`, after every reading unit and after
   * `dig`, so a timeout, crash or cancel leaves a valid partial result instead of nothing.
   * Each snapshot is deterministic and self-contained (`PipelineCheckpoint`).
   */
  readonly onCheckpoint?: (snapshot: PipelineCheckpoint) => void | Promise<void>;
}

/** Linker outcome of one run — per-pass counters plus the combined audit trail. */
export interface PipelineVerification {
  readonly read: LinkStats;
  readonly dig: LinkStats | null;
  readonly synthesize: LinkStats;
  readonly issues: readonly LinkIssue[];
}

/** Everything one review run produced, with honest per-pass metadata and linker counts. */
export interface ReviewPipelineResult {
  readonly report: SynthesizeOutput;
  /** The engine-validated theme partition this run used — the report change map (E7.4). */
  readonly themes: readonly NormalizedTheme[];
  readonly structuredFindings: StructuredFindings;
  readonly passes: readonly PassMeta[];
  readonly contextManifest: ReviewContextManifest;
  readonly verification: PipelineVerification;
  /** Silent-skip surface computed by the digest (E8). */
  readonly surfaces: DigestBundle["surfaces"];
  /** Deterministic engine findings of the digest (E9) — persisted for history compare. */
  readonly engineFindings: DigestBundle["findings"];
  /**
   * Non-null when a pass degraded (timeout/dead transport) and the report is a **partial** one:
   * the readings that happened are kept, synthesis did not complete. Cancellation never degrades.
   */
  readonly degradedReason: string | null;
}

/** Dependencies of the review pipeline. */
export interface ReviewPipelineDeps {
  readonly runner: WorkflowRunner;
  readonly config: PassConfig;
}

/** Wire the real Insea transport — callers with tests inject a scripted runner instead. */
export function createReviewDeps(config: PassConfig): ReviewPipelineDeps {
  return { runner: runInseaWorkflow, config };
}

/**
 * The v2 review pipeline (E7.2, decision #28): `map → read×N → (L1) → [dig] → (L2) → synthesize
 * → (L3) → persist`.
 *
 * - `map` refines the engine partition; `normalizeThemes` rejects any drift from set equality.
 * - `read` runs once per reading unit — every unit, every run — so results cannot vary because
 *   a single sampling call happened to look elsewhere. Units go through a bounded pool
 *   (`AI_READ_CONCURRENCY`); outcomes are folded in unit order, so the pool can only move wall time,
 *   never the report — and on this endpoint it does not even move that (measured: `payload:probe`),
 *   which is why the default is 1.
 * - **L1** re-reads units that produced no signal and units owning engine findings no finding
 *   cited yet (≤2 rounds); whatever is still uninterpreted lands in `unknowns`, honestly.
 * - **L2**: the linker evaluated every claim at the read boundary — only true claims survive,
 *   so contradictions cannot reach the merge.
 * - `dig` is a single focused round over the reading flow's queries (server-side resolution).
 * - **L3** re-runs `synthesize` with linker issues as constraints, but only when an issue makes
 *   the report substantively wrong (`BLOCKING_SYNTHESIZE_ISSUE_KINDS`); every strip and downgrade
 *   stays recorded in `verification.issues`.
 * - Any pass may **degrade** instead of killing the run: a timeout or dead transport is recorded
 *   and the run ends with a partial report (`degradedReason`) built from the readings that did
 *   happen. Cancellation always propagates.
 *
 * Citations are checked against the full digest registry + fact store; the budgeted evidence
 * pack is payload, not authority.
 */
export async function runReviewPipeline(
  deps: ReviewPipelineDeps,
  input: ReviewPipelineInput,
): Promise<ReviewPipelineResult> {
  const digest = input.digest;
  const context = buildReviewContext(digest, {
    ...(input.goal === undefined ? {} : { goal: input.goal }),
    ...(input.lens === undefined ? {} : { lens: input.lens }),
  });
  const index = buildFactIndex(digest);
  const authoritativeAnchors = evidenceAnchorsOf(digest);
  const notify = async (event: PipelineStageEvent): Promise<void> => {
    if (input.onEvent !== undefined) await input.onEvent(event);
  };

  const changePaths = digest.changeFacts.map((fact) => fact.path).sort(compareStrings);
  const units = digest.plan.units;
  const anchorFiles = new Map(digest.anchors.map((anchor) => [anchor.id, anchor.file] as const));
  const passes: PassMeta[] = [];
  const issues: LinkIssue[] = [];

  let readStats = emptyLinkStats();
  let digStats: LinkStats | null = null;
  let synthesizeStats = emptyLinkStats();
  const collectedFindings: ReadFinding[] = [];
  const collectedUnknowns: string[] = [];
  const collectedNegatives: string[] = [];
  const collectedAnswers: string[] = [];
  const queries: string[] = [];
  /** First degraded pass wins — it names the root cause the user sees in the banner. */
  let degradedReason: string | null = null;

  let themes: NormalizedTheme[] = [];

  const snapshotStructured = (): StructuredFindings =>
    mergeStructured({
      findings: collectedFindings,
      unknowns: collectedUnknowns,
      negativeResults: collectedNegatives,
      answers: collectedAnswers,
    });

  /** Checkpoint hook (A4b): a valid partial result the server can persist before the next call. */
  const notifyCheckpoint = async (): Promise<void> => {
    if (input.onCheckpoint === undefined) return;
    await input.onCheckpoint({
      themes: [...themes],
      structured: snapshotStructured(),
      passes: [...passes],
      verification: {
        read: readStats,
        dig: digStats,
        synthesize: synthesizeStats,
        issues: [...issues],
      },
      contextManifest: context.manifest,
    });
  };

  /** Record a degraded pass: the run continues with whatever it already produced. */
  const degrade = (
    pass: "map" | "read" | "dig" | "synthesize",
    error: AiError,
    target: string,
  ): void => {
    if (degradedReason === null) {
      degradedReason = `AI review incomplete (${error.code}): ${error.message}`;
    }
    issues.push({
      kind: degradedIssueKind(pass, error.code),
      pass,
      target,
      detail: `${pass} call failed (${error.code}): ${error.message}`,
    });
  };
  if (changePaths.length > 0) {
    const idToPath = changeFileIds(context).idToPath;
    let mapConstraints: string[] = [];
    let mapDone = false;
    /** Last degradable transport failure of the map pass — decides the issue kind. */
    let mapFailure: AiError | null = null;
    for (let round = 1; round <= MAX_MAP_ROUNDS; round++) {
      await notify({ stage: "map", state: "started", ...(round === 1 ? {} : { round }) });
      let normalized: { themes: NormalizedTheme[] } | { error: string };
      try {
        const map = await runMapPass(deps, context, mapConstraints, input.signal);
        await notify({
          stage: "map",
          state: "completed",
          ...(round === 1 ? {} : { round }),
          latencyMs: map.meta.latencyMs,
          salvage: map.meta.salvage,
        });
        passes.push(map.meta);
        normalized = normalizeThemes(map.output, idToPath);
      } catch (error) {
        const degraded = degradableError(error);
        if (degraded !== null) {
          // A dead transport is not a partition error: record it, retry within the round budget,
          // and let the engine partition carry the run if it never answers.
          mapFailure = degraded;
          normalized = { error: `map call failed (${degraded.code}): ${degraded.message}` };
        } else if (error instanceof AiError && error.code === "invalid-output") {
          // Schema drift is a repairable partition error here, not a reason to lose the review.
          normalized = {
            error: `map output failed schema validation: ${error.details ?? error.message}`,
          };
        } else {
          // Cancellation and any non-AI failure keep their existing meaning: propagate.
          throw error;
        }
      }
      if (!("error" in normalized)) {
        themes = normalized.themes;
        mapDone = true;
        break;
      }
      mapConstraints = [
        normalized.error,
        `Use only the file ids listed in skeleton.json (f1…f${idToPath.size}), every id exactly once; every theme needs at least one id.`,
      ];
    }
    if (!mapDone) {
      // The engine partition is a valid exact cover by construction — the review always runs;
      // at worst it loses the model's theme naming, never the readings or the report.
      themes = context.plan.partition.clusters.map((cluster, index) => ({
        id: `theme-${index + 1}`,
        name: cluster.id,
        files: [...cluster.files],
      }));
      if (mapFailure === null) {
        issues.push({
          kind: "map-invalid",
          pass: "map",
          target: "partition",
          detail: `map output invalid after ${MAX_MAP_ROUNDS} rounds; the engine base partition is used`,
        });
      } else {
        degrade("map", mapFailure, "partition");
      }
      collectedUnknowns.push(
        "AI could not group the changes into themes; the engine's base partition is used instead (only theme naming is affected).",
      );
    }
    await notifyCheckpoint();

    const retryUnits = new Set<number>();
    const evidenceIds = new Set(context.evidence.map((anchor) => anchor.id));
    const bodyBytesByFile = new Map<string, number>();
    for (const body of digest.bodies) {
      bodyBytesByFile.set(
        body.file,
        (bodyBytesByFile.get(body.file) ?? 0) + Buffer.byteLength(body.text, "utf8") + 96,
      );
    }
    /** Max simultaneous `read` calls; the caller opts in, the pipeline never widens itself. */
    const readConcurrency = normalizeConcurrency(deps.config.readConcurrency);

    /**
     * One read call — a unit's chunk at a given round. Reads run in a bounded pool, so a call must
     * not touch the run's shared state: it returns what it contributed, and the round folds those
     * outcomes in unit order, which is what keeps the pool size a matter of wall time only.
     */
    const readChunk = async (
      unit: (typeof units)[number],
      chunk: ReadChunk,
      chunks: number,
      round: number,
      constraints: readonly string[],
    ): Promise<ReadCallOutcome> => {
      const fileSet = new Set(unit.files);
      const relatedFindings = digest.findings.filter((finding) =>
        finding.anchors.some((anchorId) => fileSet.has(anchorFiles.get(anchorId) ?? "")),
      );
      const unitAnchors = digest.anchors.filter((anchor) => fileSet.has(anchor.file));
      const chunkFileSet = new Set(chunk.files);
      const chunkAnchors = selectUnitAnchors(unitAnchors, evidenceIds).filter((anchor) =>
        chunkFileSet.has(anchor.file),
      );
      const target =
        chunks > 1 ? `unit-${unit.index + 1} chunk ${chunk.index + 1}` : `unit-${unit.index + 1}`;
      await notify({
        stage: "read",
        state: "started",
        unit: unit.index + 1,
        units: units.length,
        chunk: chunk.index + 1,
        chunks,
        round,
      });
      let read: ReadPassResult;
      try {
        read = await runReadPass(
          deps,
          context,
          { index: unit.index, files: chunk.files, payload: chunk.payload },
          {
            round,
            constraints,
            relatedFindings,
            anchors: chunkAnchors,
            chunk: chunk.index + 1,
            chunks,
          },
          input.signal,
        );
      } catch (error) {
        const degraded = degradableError(error);
        // A dead transport must never kill the run either: the unit is re-read in L1, and if it
        // never answers the report still carries what the other units produced.
        if (degraded !== null) return { ok: false, target, kind: "degraded", error: degraded };
        // One malformed chunk must never kill the run: record it, re-read the unit in L1.
        if (error instanceof AiError && error.code === "invalid-output") {
          return { ok: false, target, kind: "invalid", detail: error.details ?? error.message };
        }
        throw error;
      }
      await notify({
        stage: "read",
        state: "completed",
        unit: unit.index + 1,
        units: units.length,
        chunk: chunk.index + 1,
        chunks,
        round,
        latencyMs: read.meta.latencyMs,
        salvage: read.meta.salvage,
      });
      const linked = linkFindings(read.output.findings, index, { pass: "read" });
      return {
        ok: true,
        meta: read.meta,
        stats: linked.stats,
        issues: linked.issues,
        findings: linked.findings,
        unknowns: read.output.unknowns,
        negatives: read.output.negativeResults,
        queries: read.output.needMore,
        signal:
          linked.findings.length > 0 ||
          read.output.unknowns.length > 0 ||
          read.output.negativeResults.length > 0,
      };
    };

    /**
     * Read a batch of units at one round with at most `readConcurrency` calls in flight, then fold
     * the outcomes in unit order. A round that ends in cancellation still checkpoints the calls that
     * already answered instead of throwing their work away.
     */
    const readRound = async (
      batch: readonly (typeof units)[number][],
      round: number,
      constraints: readonly string[],
    ): Promise<void> => {
      const planned = batch.map((unit) => ({
        unit,
        chunks: chunkReadingUnit(unit, bodyBytesByFile, READ_CHUNK_BUDGET_BYTES),
      }));
      const tasks = planned.flatMap(({ unit, chunks }) =>
        chunks.map((chunk) => ({ unit, chunk, chunks: chunks.length })),
      );
      const outcomes: (ReadCallOutcome | undefined)[] = new Array(tasks.length);
      let failure: { readonly error: unknown } | null = null;
      try {
        await mapBounded(tasks, readConcurrency, outcomes, (task) =>
          readChunk(task.unit, task.chunk, task.chunks, round, constraints),
        );
      } catch (error) {
        failure = { error };
      }

      // Fold in unit order. Tasks are unit-major and chunk-minor, so each bucket is already in the
      // order a sequential run would have produced.
      const buckets = new Map<number, ReadCallOutcome[]>();
      for (const { unit } of planned) buckets.set(unit.index, []);
      tasks.forEach((task, taskIndex) => {
        const outcome = outcomes[taskIndex];
        if (outcome !== undefined) buckets.get(task.unit.index)?.push(outcome);
      });
      for (const { unit, chunks } of planned) {
        let signalSeen = false;
        let failedChunks = 0;
        for (const outcome of buckets.get(unit.index) ?? []) {
          if (!outcome.ok) {
            failedChunks += 1;
            if (outcome.kind === "degraded") {
              degrade("read", outcome.error, outcome.target);
            } else {
              issues.push({
                kind: "read-invalid",
                pass: "read",
                target: outcome.target,
                detail: `read output failed schema validation: ${outcome.detail}`,
              });
            }
            continue;
          }
          passes.push(outcome.meta);
          readStats = addLinkStats(readStats, outcome.stats);
          issues.push(...outcome.issues);
          collectedFindings.push(...outcome.findings);
          collectedUnknowns.push(...outcome.unknowns);
          collectedNegatives.push(...outcome.negatives);
          for (const query of outcome.queries) {
            if (queries.length < 3 && !queries.includes(query)) queries.push(query);
          }
          if (outcome.signal) signalSeen = true;
        }
        // Coverage, not tidiness: a chunk that failed contributed no readings, so the files it owned
        // were never read at all. Re-read the unit when any chunk failed (`failedChunks ===
        // chunks.length` used to mean a partially failed unit was silently left half-read). A unit
        // that answered in full is never queued: only `retryUnits` or `selectCoverageTargets` qualify.
        if (chunks.length > 0 && failedChunks > 0) {
          retryUnits.add(unit.index);
        } else if (signalSeen) {
          retryUnits.delete(unit.index);
        }
      }

      await notifyCheckpoint();
      if (failure !== null) throw failure.error;
    };

    await readRound(units, 1, []);

    // L1 coverage loop: engine findings must be interpreted (their anchors cited) or land in unknowns.
    for (let round = 2; round <= MAX_COVERAGE_ROUNDS; round++) {
      const readAnchors = new Set(collectedFindings.flatMap((finding) => finding.anchors));
      const unaddressed = digest.findings.filter(
        (finding) =>
          finding.anchors.length > 0 &&
          finding.anchors.every((anchorId) => !readAnchors.has(anchorId)),
      );
      const targets = selectCoverageTargets({ units, retryUnits, unaddressed, anchorFiles });
      if (targets.length === 0) break;
      const anchorMap = new Map(digest.anchors.map((anchor) => [anchor.id, anchor] as const));
      const constraints = unaddressed
        .slice(0, MAX_CONSTRAINT_LINES)
        .map((finding) => {
          const anchorHints = finding.anchors
            .slice(0, 3)
            .map((id) => {
              const a = anchorMap.get(id);
              if (!a?.snippet) return id;
              const snippet = a.snippet.replace(/\r?\n|\r/g, " ").trim();
              const preview = snippet.length > 50 ? `${snippet.slice(0, 47)}...` : snippet;
              return `${id} ("${preview}" L${a.lineStart})`;
            })
            .join("; ");
          return `${finding.ruleId}: ${finding.title} — anchors: ${anchorHints}`;
        });
      await readRound(targets, round, constraints);
    }
    const finalReadAnchors = new Set(collectedFindings.flatMap((finding) => finding.anchors));
    for (const finding of digest.findings) {
      if (finding.anchors.length === 0) continue;
      if (finding.anchors.every((anchorId) => !finalReadAnchors.has(anchorId))) {
        collectedUnknowns.push(
          `Engine finding not interpreted during reading: ${finding.ruleId} — ${finding.title} (${finding.id}).`,
        );
      }
    }
  }

  // dig — one focused round over at most three queries, deterministic server-side resolution.
  if (queries.length > 0) {
    await notify({ stage: "dig", state: "started" });
    let dig: DigPassResult | undefined;
    try {
      dig = await runDigPass(deps, context, queries, input.signal, authoritativeAnchors);
    } catch (error) {
      const degraded = degradableError(error);
      if (degraded !== null) {
        degrade("dig", degraded, "dig");
      } else {
        if (!(error instanceof AiError) || error.code !== "invalid-output") throw error;
        issues.push({
          kind: "dig-invalid",
          pass: "dig",
          target: "dig",
          detail: `dig output failed schema validation: ${error.details ?? error.message}`,
        });
      }
    }
    if (dig === undefined) {
      collectedUnknowns.push(
        "Dig output was unusable; the reading flow's queries stay unanswered.",
      );
    } else {
      await notify({
        stage: "dig",
        state: "completed",
        latencyMs: dig.meta.latencyMs,
        salvage: dig.meta.salvage,
      });
      passes.push(dig.meta);
      const linked = linkFindings(dig.output.findings, index, { pass: "dig" });
      digStats = linked.stats;
      issues.push(...linked.issues);
      collectedFindings.push(...linked.findings);
      collectedUnknowns.push(...dig.output.unknowns);
      collectedAnswers.push(...dig.output.answers);
    }
  }
  await notifyCheckpoint();

  // L2 — claims were evaluated at the link boundary (only true claims survive); the merge
  // dedupes by statement + anchors + claim key, so remaining findings cannot contradict.
  const structured = snapshotStructured();
  const seenAnchors = new Set(structured.findings.flatMap((finding) => finding.anchors));
  const themeIds = themes.map((theme) => theme.id);

  // L3 verify→revise loop: synthesize, link, feed issues back as constraints (≤2 rounds).
  let report: SynthesizeOutput | undefined;
  let constraints: string[] = [];
  /** Last degradable synthesize failure — the partial report's reason when nothing survives. */
  let synthFailure: AiError | null = null;
  for (let round = 1; round <= MAX_SYNTHESIZE_ROUNDS; round++) {
    await notify({ stage: "synthesize", state: "started", round });
    let synthesize: SynthesizePassResult | undefined;
    try {
      synthesize = await runSynthesizePass(
        deps,
        { context, structured, themes, constraints, round },
        input.signal,
      );
    } catch (error) {
      const degraded = degradableError(error);
      if (degraded !== null) {
        if (report !== undefined && report.findings.length > 0) {
          // If a previous synthesize round already produced a valid report, keep it instead of degrading!
          break;
        }
        // The model never answered: try the next round, and if it stays down the readings are
        // still reported as a partial result instead of being thrown away.
        degrade("synthesize", degraded, "synthesize");
        synthFailure = degraded;
        continue;
      }
      // Schema drift is a repairable round here too — never lose the readings to one bad reply.
      if (!(error instanceof AiError) || error.code !== "invalid-output") throw error;
      issues.push({
        kind: "synthesize-invalid",
        pass: "synthesize",
        target: "synthesize",
        detail: `synthesize output failed schema validation: ${error.details ?? error.message}`,
      });
      constraints = [
        `Your previous output failed validation: ${error.details ?? error.message}`,
        "Reply with strict JSON only, exactly the specified keys and enum values.",
      ];
      continue;
    }
    if (synthesize === undefined) {
      continue;
    }
    await notify({
      stage: "synthesize",
      state: "completed",
      round,
      latencyMs: synthesize.meta.latencyMs,
      salvage: synthesize.meta.salvage,
    });
    passes.push(synthesize.meta);
    const linked = linkReport(synthesize.output, index, { seenAnchors, themeIds });
    issues.push(...linked.issues);
    synthesizeStats = linked.stats;
    report = linked.report;
    const blocking = linked.issues.some((issue) => BLOCKING_SYNTHESIZE_ISSUE_KINDS.has(issue.kind));
    if (!blocking) break;

    // Fast Repair Gate: check if mechanical salvage resolves all blocking issues cleanly
    // (e.g. dropping unverifiable claims, injecting missing theme narratives)
    // to avoid an expensive and risky re-synthesis round that could time out.
    const repaired = fastRepairSynthesizeOutput(synthesize.output, index, themeIds);
    if (repaired !== null) {
      const repairedLinked = linkReport(repaired, index, { seenAnchors, themeIds });
      const repairedBlocking = repairedLinked.issues.some((issue) =>
        BLOCKING_SYNTHESIZE_ISSUE_KINDS.has(issue.kind),
      );
      if (!repairedBlocking && repairedLinked.report.findings.length > 0) {
        report = repairedLinked.report;
        synthesizeStats = repairedLinked.stats;
        issues.push(...repairedLinked.issues);
        break;
      }
      if (round === MAX_SYNTHESIZE_ROUNDS) {
        if (
          repairedLinked.report.findings.length > report.findings.length ||
          repairedLinked.report.themes.length > report.themes.length
        ) {
          report = repairedLinked.report;
          synthesizeStats = repairedLinked.stats;
        }
        break;
      }
    } else if (round === MAX_SYNTHESIZE_ROUNDS) {
      break;
    }
    constraints = linked.issues
      .slice(0, MAX_CONSTRAINT_LINES)
      .map((issue) => `${issue.kind}: ${issue.target} — ${issue.detail}`);
  }
  if (report === undefined) {
    // Nothing the model produced at all: hand over to the deterministic fallback exactly as
    // before — there is no reading to rescue.
    if (passes.length === 0 && structured.findings.length === 0) {
      // Re-throw the real cause (timeout, dead transport, missing config) so the deterministic
      // fallback names it instead of a synthetic schema error.
      throw synthFailure ?? new AiError("invalid-output", "synthesize produced no report");
    }
    const partial = buildPartialReport({
      digest,
      structured,
      reason:
        degradedReason ??
        `AI review incomplete (${synthFailure?.code ?? "invalid-output"}): ${
          synthFailure?.message ?? "synthesize output failed schema validation"
        }`,
    });
    report = partial.report;
    degradedReason = degradedReason ?? partial.reason;
  }

  return {
    report,
    themes,
    structuredFindings: structured,
    passes,
    contextManifest: context.manifest,
    verification: {
      read: readStats,
      dig: digStats,
      synthesize: synthesizeStats,
      issues,
    },
    surfaces: digest.surfaces,
    engineFindings: digest.findings,
    degradedReason,
  };
}

/** Code-unit string compare — deterministic across platforms and locales. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * What one read call contributed. Reads run in a bounded pool (`mapBounded`), so a call may not
 * touch the run's shared state: it returns this, and the round folds the outcomes in unit order.
 */
type ReadCallOutcome =
  | {
      readonly ok: true;
      readonly meta: PassMeta;
      readonly stats: LinkStats;
      readonly issues: readonly LinkIssue[];
      readonly findings: readonly ReadFinding[];
      readonly unknowns: readonly string[];
      readonly negatives: readonly string[];
      readonly queries: readonly string[];
      /** The call answered with something — decides whether its unit needs an L1 re-read. */
      readonly signal: boolean;
    }
  | {
      readonly ok: false;
      readonly target: string;
      readonly kind: "degraded";
      readonly error: AiError;
    }
  | {
      readonly ok: false;
      readonly target: string;
      readonly kind: "invalid";
      readonly detail: string;
    };

/**
 * Run `worker` over `items` with at most `limit` calls in flight, writing each result into `results`
 * at the item's index as it lands.
 *
 * The array is index-aligned on purpose: callers fold it in **input order**, so the pool size cannot
 * reorder anything — and when a worker throws, the entries that already landed stay readable, which
 * is how a cancelled reading round keeps the calls that answered.
 */
async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  results: (R | undefined)[],
  worker: (item: T) => Promise<R>,
): Promise<void> {
  let next = 0;
  const pump = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => pump()));
}

/**
 * Reading concurrency as configured at the boundary.
 * Defaults to 1 because Insea's shared endpoint queues overlapping calls and inflates
 * latency up to 8x when concurrency > 1. Respects any caller-configured concurrency.
 * Folds results strictly in unit order for deterministic execution.
 */
function normalizeConcurrency(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.max(1, Math.floor(value));
}

/**
 * Fast repair gate for synthesize output: mechanically repairs fixable issues
 * (e.g., dropping invalid/false claims so statements survive, injecting missing theme narratives)
 * to avoid returning an empty or degraded report when real findings were discovered.
 */
function fastRepairSynthesizeOutput(
  raw: SynthesizeOutput,
  index: FactIndex,
  themeIds: readonly string[],
): SynthesizeOutput | null {
  let modified = false;

  const findings = raw.findings.map((f) => {
    if (f.claims && f.claims.length > 0) {
      const validClaims = f.claims.filter((c) => {
        try {
          return evaluateClaim(c, index) === "true";
        } catch {
          return false;
        }
      });
      if (validClaims.length !== f.claims.length) {
        modified = true;
        return {
          ...f,
          claims: validClaims,
          confidence: f.confidence === "exact" ? ("inferred" as const) : f.confidence,
        };
      }
    }
    return f;
  });

  const presentThemeIds = new Set(raw.themes.map((t) => t.themeId));
  const themes = [...raw.themes];
  for (const themeId of themeIds) {
    if (!presentThemeIds.has(themeId)) {
      modified = true;
      themes.push({
        themeId,
        summary: "Theme changes analyzed without narrative.",
        behaviorChange: "See related findings.",
        watchFor: "Verification in game.",
        anchorIds: [],
      });
    }
  }

  if (!modified) return null;
  return {
    ...raw,
    findings,
    themes,
  };
}

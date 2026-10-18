import type {
  Anchor,
  DigestBundle,
  DigestUnit,
  ReadFinding,
  ReviewLens,
  SynthesizeOutput,
} from "@craftland-qa/contracts";
import { buildReviewContext, changeFileIds, evidenceAnchorsOf } from "../context/build.js";
import type { EvidenceAnchor, ReviewContextManifest } from "../context/types.js";
import { AiError } from "../errors.js";
import { buildFactIndex } from "../facts/fact-index.js";
import { runInseaWorkflow } from "../insea/client.js";
import type { InseaSalvage } from "../insea/types.js";
import {
  addLinkStats,
  emptyLinkStats,
  type LinkIssue,
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

/** Map loop bound: map re-runs with repair constraints; then the engine partition takes over. */
export const MAX_MAP_ROUNDS = 2;

/** Revise loop bound: synthesize is re-run at most this many times with linker constraints. */
export const MAX_SYNTHESIZE_ROUNDS = 2;

/** How many constraints/issues are handed back to a re-run (attention quality). */
const MAX_CONSTRAINT_LINES = 10;

/** Upper bound of snippet anchors shipped to one read call (grounding text per unit). */
const MAX_UNIT_ANCHORS = 300;

/** Per-file cap inside one read call — every file keeps representation (E7.5 balance). */
const MAX_ANCHORS_PER_FILE = 40;

/**
 * Byte budget of one read call's material (compact payload + function bodies). Units whose
 * material exceeds it are read chunk by chunk — sequential calls, nothing dropped (E7.5).
 */
const READ_CHUNK_BUDGET_BYTES = 90_000;

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

/** Input of one review run — the digest plus the user's goal and lens. */
export interface ReviewPipelineInput {
  readonly digest: DigestBundle;
  readonly goal?: string;
  readonly lens?: ReviewLens;
  readonly signal?: AbortSignal;
  /** Optional progress hook — called around every pass, never inside the linker. */
  readonly onEvent?: (event: PipelineStageEvent) => void | Promise<void>;
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
 *   a single sampling call happened to look elsewhere.
 * - **L1** re-reads units that produced no signal and units owning engine findings no finding
 *   cited yet (≤2 rounds); whatever is still uninterpreted lands in `unknowns`, honestly.
 * - **L2**: the linker evaluated every claim at the read boundary — only true claims survive,
 *   so contradictions cannot reach the merge.
 * - `dig` is a single focused round over the reading flow's queries (server-side resolution).
 * - **L3** re-runs `synthesize` with linker issues as constraints (≤2 rounds); every strip and
 *   downgrade stays recorded in `verification.issues`.
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
  const collectedFindings: ReadFinding[] = [];
  const collectedUnknowns: string[] = [];
  const collectedNegatives: string[] = [];
  const collectedAnswers: string[] = [];
  const queries: string[] = [];

  let themes: NormalizedTheme[] = [];
  if (changePaths.length > 0) {
    const idToPath = changeFileIds(context).idToPath;
    let mapConstraints: string[] = [];
    let mapDone = false;
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
        // Schema drift is a repairable partition error here, not a reason to lose the review.
        if (!(error instanceof AiError) || error.code !== "invalid-output") throw error;
        normalized = {
          error: `map output failed schema validation: ${error.details ?? error.message}`,
        };
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
      issues.push({
        kind: "map-invalid",
        pass: "map",
        target: "partition",
        detail: `map output invalid after ${MAX_MAP_ROUNDS} rounds; the engine base partition is used`,
      });
      collectedUnknowns.push(
        "AI could not group the changes into themes; the engine's base partition is used instead (only theme naming is affected).",
      );
    }

    const noSignalUnits = new Set<number>();
    const evidenceIds = new Set(context.evidence.map((anchor) => anchor.id));
    const bodyBytesByFile = new Map<string, number>();
    for (const body of digest.bodies) {
      bodyBytesByFile.set(
        body.file,
        (bodyBytesByFile.get(body.file) ?? 0) + Buffer.byteLength(body.text, "utf8") + 96,
      );
    }
    const readUnit = async (
      unit: (typeof units)[number],
      round: number,
      constraints: readonly string[],
    ): Promise<void> => {
      const fileSet = new Set(unit.files);
      const relatedFindings = digest.findings.filter((finding) =>
        finding.anchors.some((anchorId) => fileSet.has(anchorFiles.get(anchorId) ?? "")),
      );
      const unitAnchors = digest.anchors.filter((anchor) => fileSet.has(anchor.file));
      const anchors = selectUnitAnchors(unitAnchors, evidenceIds);
      const chunks = chunkReadingUnit(unit, bodyBytesByFile, READ_CHUNK_BUDGET_BYTES);
      let signalSeen = false;
      let failedChunks = 0;
      for (const chunk of chunks) {
        const chunkFileSet = new Set(chunk.files);
        const chunkAnchors = anchors.filter((anchor) => chunkFileSet.has(anchor.file));
        await notify({
          stage: "read",
          state: "started",
          unit: unit.index + 1,
          units: units.length,
          chunk: chunk.index + 1,
          chunks: chunks.length,
          round,
        });
        let read: ReadPassResult | undefined;
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
              chunks: chunks.length,
            },
            input.signal,
          );
        } catch (error) {
          // One malformed chunk must never kill the run: record it, re-read the unit in L1.
          if (!(error instanceof AiError) || error.code !== "invalid-output") throw error;
          failedChunks += 1;
          issues.push({
            kind: "read-invalid",
            pass: "read",
            target:
              chunks.length > 1
                ? `unit-${unit.index + 1} chunk ${chunk.index + 1}`
                : `unit-${unit.index + 1}`,
            detail: `read output failed schema validation: ${error.details ?? error.message}`,
          });
          continue;
        }
        await notify({
          stage: "read",
          state: "completed",
          unit: unit.index + 1,
          units: units.length,
          chunk: chunk.index + 1,
          chunks: chunks.length,
          round,
          latencyMs: read.meta.latencyMs,
          salvage: read.meta.salvage,
        });
        passes.push(read.meta);
        const linked = linkFindings(read.output.findings, index, { pass: "read" });
        readStats = addLinkStats(readStats, linked.stats);
        issues.push(...linked.issues);
        collectedFindings.push(...linked.findings);
        collectedUnknowns.push(...read.output.unknowns);
        collectedNegatives.push(...read.output.negativeResults);
        for (const query of read.output.needMore) {
          if (queries.length < 3 && !queries.includes(query)) queries.push(query);
        }
        if (
          linked.findings.length > 0 ||
          read.output.unknowns.length > 0 ||
          read.output.negativeResults.length > 0
        ) {
          signalSeen = true;
        }
      }
      if (failedChunks === chunks.length) {
        noSignalUnits.add(unit.index);
        return;
      }
      if (signalSeen) noSignalUnits.delete(unit.index);
      else if (round === 1) noSignalUnits.add(unit.index);
    };

    for (const unit of units) {
      await readUnit(unit, 1, []);
    }

    // L1 coverage loop: engine findings must be interpreted (their anchors cited) or land in unknowns.
    for (let round = 2; round <= MAX_COVERAGE_ROUNDS; round++) {
      const readAnchors = new Set(collectedFindings.flatMap((finding) => finding.anchors));
      const unaddressed = digest.findings.filter(
        (finding) =>
          finding.anchors.length > 0 &&
          finding.anchors.every((anchorId) => !readAnchors.has(anchorId)),
      );
      const targets = units.filter((unit) => {
        if (noSignalUnits.has(unit.index)) return true;
        const files = new Set(unit.files);
        return unaddressed.some((finding) =>
          finding.anchors.some((anchorId) => files.has(anchorFiles.get(anchorId) ?? "")),
        );
      });
      if (targets.length === 0) break;
      const constraints = unaddressed
        .slice(0, MAX_CONSTRAINT_LINES)
        .map(
          (finding) =>
            `${finding.ruleId}: ${finding.title} — anchors: ${finding.anchors.join(", ")}`,
        );
      for (const unit of targets) {
        await readUnit(unit, round, constraints);
      }
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
      if (!(error instanceof AiError) || error.code !== "invalid-output") throw error;
      issues.push({
        kind: "dig-invalid",
        pass: "dig",
        target: "dig",
        detail: `dig output failed schema validation: ${error.details ?? error.message}`,
      });
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

  // L2 — claims were evaluated at the link boundary (only true claims survive); the merge
  // dedupes by statement + anchors + claim key, so remaining findings cannot contradict.
  const structured = mergeStructured({
    findings: collectedFindings,
    unknowns: collectedUnknowns,
    negativeResults: collectedNegatives,
    answers: collectedAnswers,
  });
  const seenAnchors = new Set(structured.findings.flatMap((finding) => finding.anchors));
  const themeIds = themes.map((theme) => theme.id);

  // L3 verify→revise loop: synthesize, link, feed issues back as constraints (≤2 rounds).
  let report: SynthesizeOutput | undefined;
  let synthesizeStats = emptyLinkStats();
  let constraints: string[] = [];
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
    if (linked.issues.length === 0 || round === MAX_SYNTHESIZE_ROUNDS) break;
    constraints = linked.issues
      .slice(0, MAX_CONSTRAINT_LINES)
      .map((issue) => `${issue.kind}: ${issue.target} — ${issue.detail}`);
  }
  if (report === undefined) {
    throw new AiError("invalid-output", "synthesize produced no report");
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
  };
}

/** Code-unit string compare — deterministic across platforms and locales. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

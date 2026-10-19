import type { DigestBundle, DigestFinding } from "@silentskip/contracts";
import { collectAnchorPriorities, evidenceAnchorsOf, selectEvidence } from "../context/build.js";
import type { EvidenceAnchor, ReviewContextManifest, TaskPack } from "../context/types.js";
import { buildFactIndex, type FactIndex } from "../facts/fact-index.js";
import type { InseaAttachment } from "../insea/types.js";

/** Evidence budget of one What-If call (attention economy; the digest registry stays authority). */
export const WHATIF_EVIDENCE_BUDGET = 200;
/** Ledger limits — the session memory stays small enough to always ride along. */
export const LEDGER_CLAIM_LIMIT = 30;
export const LEDGER_ANCHOR_LIMIT = 20;

/**
 * Extract semantic search tokens from a question (length >= 3, excluding stopwords).
 */
export function extractQuestionKeywords(question: string): string[] {
  const STOPWORDS = new Set([
    "the", "and", "for", "with", "from", "that", "this", "what", "which",
    "when", "where", "why", "how", "did", "does", "done", "have", "has",
    "had", "are", "were", "was", "been", "being", "into", "over", "about",
    "tại", "sao", "cho", "của", "trong", "với", "được", "không", "những",
    "nào", "thế", "này", "đang", "thay", "đổi", "biến", "động", "kiểm", "tra",
  ]);
  return [
    ...new Set(
      question
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_./-]+/gu, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 3 && !STOPWORDS.has(token)),
    ),
  ];
}

/**
 * Mechanically composed session memory — no AI summarization call. After each linked answer
 * the engine folds its evidence statements, unknowns and used anchors in (deterministically).
 */
export interface WhatIfLedger {
  uptoTurn: number;
  /** Established evidence statements from earlier turns (rendered text). */
  claims: string[];
  /** Open unknowns carried forward. */
  unknowns: string[];
  /** Anchors used by earlier answers — boosted to the front of every next evidence pack. */
  anchors: string[];
}

/** A fresh empty ledger. */
export function emptyWhatIfLedger(): WhatIfLedger {
  return { uptoTurn: 0, claims: [], unknowns: [], anchors: [] };
}

/** Parse a stored ledger JSON; malformed or missing data yields a fresh empty ledger. */
export function parseWhatIfLedger(raw: string | null): WhatIfLedger {
  if (raw === null) return emptyWhatIfLedger();
  try {
    const parsed = JSON.parse(raw) as Partial<WhatIfLedger>;
    const strings = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    return {
      uptoTurn: typeof parsed.uptoTurn === "number" ? parsed.uptoTurn : 0,
      claims: strings(parsed.claims),
      unknowns: strings(parsed.unknowns),
      anchors: strings(parsed.anchors),
    };
  } catch {
    return emptyWhatIfLedger();
  }
}

/** One already-answered turn, as reconstruction material. */
export interface WhatIfTurnInput {
  question: string;
  answer: string;
  anchors: string[];
}

/** One pinned anchor of the comparison. */
export interface WhatIfPinInput {
  anchorId: string;
  note: string | null;
}

/** Latest persisted review of this comparison — optional context for the chat. */
export interface WhatIfRunReport {
  verdict: string;
  qualityScore: number;
  report: unknown;
}

export interface WhatIfContextInput {
  digest: DigestBundle;
  runSummary: WhatIfRunReport | null;
  ledger: WhatIfLedger;
  recentTurns: readonly WhatIfTurnInput[];
  pins: readonly WhatIfPinInput[];
  question: string;
}

/** Everything one What-If call needs — built fresh per message (Insea is stateless). */
export interface WhatIfContext {
  question: string;
  taskPack: TaskPack;
  factIndex: FactIndex;
  evidence: EvidenceAnchor[];
  anchorsById: ReadonlyMap<string, EvidenceAnchor>;
  ledger: WhatIfLedger;
  recentTurns: readonly WhatIfTurnInput[];
  pins: readonly WhatIfPinInput[];
  runSummary: WhatIfRunReport | null;
  engineFindings: readonly DigestFinding[];
  manifest: ReviewContextManifest;
}

/**
 * Build the per-message context: fact store + evidence pack (pins and ledger anchors boosted
 * to tier -2, question keywords boosted to tier -1) + mechanical memory (ledger + recent turns).
 */
export function buildWhatIfContext(input: WhatIfContextInput): WhatIfContext {
  const digest = input.digest;
  const allEvidence = evidenceAnchorsOf(digest);
  const priorities = collectAnchorPriorities(digest);
  const pinnedIds = new Set<string>([
    ...input.pins.map((pin) => pin.anchorId),
    ...input.ledger.anchors,
  ]);
  for (const id of pinnedIds) priorities.set(id, -2);

  const keywords = extractQuestionKeywords(input.question);
  if (keywords.length > 0) {
    for (const anchor of allEvidence) {
      if (pinnedIds.has(anchor.id)) continue;
      const fileLower = anchor.file.toLowerCase();
      const snippetLower = anchor.snippet.toLowerCase();
      const idLower = anchor.id.toLowerCase();
      if (
        keywords.some(
          (kw) => fileLower.includes(kw) || snippetLower.includes(kw) || idLower.includes(kw),
        )
      ) {
        priorities.set(anchor.id, -1);
      }
    }
  }

  const evidence = selectEvidence(allEvidence, priorities, WHATIF_EVIDENCE_BUDGET);
  const anchorsById = new Map(allEvidence.map((anchor) => [anchor.id, anchor]));
  const taskPack: TaskPack = {
    baseRef: digest.refs.base.ref,
    currentRef: digest.refs.current.ref,
    baseCommit: digest.refs.base.commitHash,
    currentCommit: digest.refs.current.commitHash,
    stats: digest.stats,
    goal: "",
    lens: "both",
  };
  const manifest: ReviewContextManifest = {
    counts: {
      changeFacts: digest.changeFacts.length,
      linked: digest.linked.length,
      contextItems: digest.context.length,
      evidence: evidence.length,
      evidenceDropped: allEvidence.length - evidence.length,
    },
    notes: [
      `what-if turn over one A/B comparison; ${input.pins.length} pin(s) and ${input.recentTurns.length} recent turn(s) always ride along`,
    ],
  };
  return {
    question: input.question,
    taskPack,
    factIndex: buildFactIndex(digest),
    evidence,
    anchorsById,
    ledger: input.ledger,
    recentTurns: input.recentTurns,
    pins: input.pins,
    runSummary: input.runSummary,
    engineFindings: digest.findings,
    manifest,
  };
}

/**
 * Fold one linked answer into the ledger — deterministic, no model call. Claims/unknowns are
 * deduplicated and capped; used anchors accumulate for the next evidence boost.
 */
export function addTurnToLedger(
  ledger: WhatIfLedger,
  turn: { statement: string[]; unknowns: string[]; anchors: string[] },
): WhatIfLedger {
  const merge = (existing: string[], additions: readonly string[], limit: number): string[] => {
    const seen = new Set(existing);
    const merged = [...existing];
    for (const item of additions) {
      const key = item.trim();
      if (key === "" || seen.has(key)) continue;
      seen.add(key);
      merged.push(key);
    }
    return merged.length > limit ? merged.slice(merged.length - limit) : merged;
  };
  return {
    uptoTurn: ledger.uptoTurn + 1,
    claims: merge(ledger.claims, turn.statement, LEDGER_CLAIM_LIMIT),
    unknowns: merge(ledger.unknowns, turn.unknowns, LEDGER_CLAIM_LIMIT),
    anchors: merge(ledger.anchors, turn.anchors, LEDGER_ANCHOR_LIMIT),
  };
}

function attachment(uploadName: string, mimeType: string, content: string): InseaAttachment {
  return { uploadName, mimeType, content };
}

/** `task.json` — refs and stats of the comparison (What-If has no goal/lens input). */
export function serializeWhatIfTaskFile(context: WhatIfContext): InseaAttachment {
  return attachment(
    "task.json",
    "application/json",
    JSON.stringify({
      mode: "whatif",
      refs: {
        base: { ref: context.taskPack.baseRef, commitHash: context.taskPack.baseCommit },
        current: { ref: context.taskPack.currentRef, commitHash: context.taskPack.currentCommit },
      },
      stats: context.taskPack.stats,
    }),
  );
}

/** `facts.json` — every citable number (quantities) plus the deterministic engine findings. */
export function serializeWhatIfFactsFile(context: WhatIfContext): InseaAttachment {
  return attachment(
    "facts.json",
    "application/json",
    JSON.stringify({
      quantities: [...context.factIndex.quantities.values()],
      engineFindings: context.engineFindings,
    }),
  );
}

/** `history.json` — the mechanical session memory: ledger + most recent turns. */
export function serializeWhatIfHistoryFile(context: WhatIfContext): InseaAttachment {
  return attachment(
    "history.json",
    "application/json",
    JSON.stringify({ ledger: context.ledger, recentTurns: context.recentTurns }),
  );
}

/** `pins.jsonl` — pinned anchors with their snippets when the registry has them. */
export function serializePinsJsonl(
  pins: readonly WhatIfPinInput[],
  anchorsById: ReadonlyMap<string, EvidenceAnchor>,
): InseaAttachment {
  const lines = pins.map((pin) => {
    const anchor = anchorsById.get(pin.anchorId);
    return JSON.stringify({
      anchorId: pin.anchorId,
      note: pin.note,
      ...(anchor === undefined
        ? {}
        : { file: anchor.file, lineStart: anchor.lineStart, snippet: anchor.snippet }),
    });
  });
  return attachment("pins.jsonl", "application/x-ndjson", lines.join("\n"));
}

/** `report.json` — the latest persisted review of this comparison, when one exists. */
export function serializeWhatIfReportFile(context: WhatIfContext): InseaAttachment {
  return attachment(
    "report.json",
    "application/json",
    JSON.stringify({
      verdict: context.runSummary?.verdict ?? null,
      qualityScore: context.runSummary?.qualityScore ?? null,
      report: context.runSummary?.report ?? null,
    }),
  );
}

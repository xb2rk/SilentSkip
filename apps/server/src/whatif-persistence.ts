import { randomUUID } from "node:crypto";
import {
  type addTurnToLedger,
  type PassMeta,
  parseWhatIfLedger,
  type WhatIfLedger,
  type WhatIfTurnInput,
} from "@silentskip/ai";
import {
  AppError,
  type AssistantTurnData,
  ErrorCodes,
  type Pin,
  type WhatIfSessionSummary,
  type WhatIfTurn,
} from "@silentskip/contracts";
import {
  type AppDatabase,
  contextManifests,
  type pins,
  runs,
  sessionLedgers,
  sessions,
  turns,
} from "@silentskip/db";
import { and, desc, eq, sql } from "drizzle-orm";

/** How many recent completed turns ride along with every question. */
export const RECENT_TURN_LIMIT = 3;

/** Latest completed review of one comparison, as the What-If context consumes it. */
export interface WhatIfRunSummary {
  readonly verdict: string;
  readonly qualityScore: number;
  readonly report: unknown;
}

/** Session row by id — throws NOT_FOUND for unknown ids. */
export function readSessionRow(db: AppDatabase, sessionId: string): typeof sessions.$inferSelect {
  const row = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (row === undefined) {
    throw new AppError(ErrorCodes.notFound, "Phiên trò chuyện không tồn tại");
  }
  return row;
}

/** Turn row by id — throws NOT_FOUND for unknown ids. */
export function readTurnRow(db: AppDatabase, turnId: string): typeof turns.$inferSelect {
  const row = db.select().from(turns).where(eq(turns.id, turnId)).get();
  if (row === undefined) {
    throw new AppError(ErrorCodes.notFound, "Lượt hỏi không tồn tại");
  }
  return row;
}

/** Number of turns (user + assistant) of one session. */
export function countTurns(db: AppDatabase, sessionId: string): number {
  const row = db
    .select({ value: sql<number>`count(*)` })
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .get();
  return row?.value ?? 0;
}

/** Project one session row for the wire. */
export function projectSessionSummary(
  row: typeof sessions.$inferSelect,
  turnCount: number,
): WhatIfSessionSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    baseRef: row.baseRef ?? "",
    currentRef: row.currentRef ?? "",
    title: row.title,
    turnCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Project one turn row for the wire. */
export function projectTurn(row: typeof turns.$inferSelect): WhatIfTurn {
  const anchors = parseStringArray(row.anchorsJson);
  const pinsUsed = parseStringArray(row.pinsJson);
  if (row.role === "user") {
    return {
      id: row.id,
      turnIndex: row.turnIndex,
      role: "user",
      content: row.content,
      answer: null,
      contextCounts: null,
      error: null,
      anchors,
      pinsUsed,
      createdAt: row.createdAt.toISOString(),
    };
  }
  const data = parseTurnData(row.content);
  return {
    id: row.id,
    turnIndex: row.turnIndex,
    role: "assistant",
    content: data.answer?.answer ?? data.error ?? "",
    answer: data.answer,
    contextCounts: data.contextCounts,
    error: data.error,
    anchors,
    pinsUsed,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Project one pin row for the wire. */
export function projectPin(row: typeof pins.$inferSelect): Pin {
  return {
    id: row.id,
    projectId: row.projectId,
    baseRef: row.baseRef,
    currentRef: row.currentRef,
    anchorId: row.anchorId,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Last completed (question, answer) pairs — reconstruction material for the next call. */
export function loadRecentTurns(
  db: AppDatabase,
  sessionId: string,
  excludeTurnId: string,
): WhatIfTurnInput[] {
  const rows = db
    .select()
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .orderBy(desc(turns.turnIndex))
    .limit(RECENT_TURN_LIMIT * 2 + 1)
    .all()
    .reverse()
    .filter((row) => row.id !== excludeTurnId);
  // A window that starts mid-pair has no question for that answer — skip it instead of
  // producing a question-less memory item.
  if (rows[0]?.role === "assistant") rows.shift();
  const completed: WhatIfTurnInput[] = [];
  let pendingQuestion: string | undefined;
  for (const row of rows) {
    if (row.id === excludeTurnId) continue;
    if (row.role === "user") {
      pendingQuestion = row.content;
      continue;
    }
    const data = parseTurnData(row.content);
    if (data.answer === null) continue;
    completed.push({
      question: pendingQuestion ?? "",
      answer: data.answer.answer,
      anchors: data.answer.evidence.flatMap((item) => item.anchors),
    });
    pendingQuestion = undefined;
  }
  return completed.slice(-RECENT_TURN_LIMIT);
}

/** Latest completed review of this comparison, when one exists. */
export function loadLatestRunReport(
  db: AppDatabase,
  projectId: string,
  baseRef: string,
  currentRef: string,
): WhatIfRunSummary | null {
  const row = db
    .select()
    .from(runs)
    .where(
      and(
        eq(runs.projectId, projectId),
        eq(runs.baseRef, baseRef),
        eq(runs.currentRef, currentRef),
        eq(runs.status, "completed"),
      ),
    )
    .orderBy(desc(runs.createdAt))
    .limit(1)
    .get();
  if (row === undefined || row.reportJson === null) return null;
  try {
    const parsed = JSON.parse(row.reportJson) as { report?: unknown };
    return {
      verdict: row.verdict ?? "insufficient_evidence",
      qualityScore: row.qualityScore ?? 0,
      report: parsed.report ?? null,
    };
  } catch {
    return null;
  }
}

/** The session's ledger, rebuilt from the stored JSON. */
export function loadLedger(db: AppDatabase, sessionId: string): WhatIfLedger {
  const row = db.select().from(sessionLedgers).where(eq(sessionLedgers.sessionId, sessionId)).get();
  return parseWhatIfLedger(row?.ledgerJson ?? null);
}

/** Persist the answer (or the honest failure) of one assistant turn. */
export function persistTurn(
  db: AppDatabase,
  turnId: string,
  data: AssistantTurnData,
  anchors: readonly string[],
  pinsUsed: readonly string[],
): void {
  db.update(turns)
    .set({
      content: JSON.stringify(data),
      anchorsJson: JSON.stringify(anchors),
      pinsJson: JSON.stringify(pinsUsed),
    })
    .where(eq(turns.id, turnId))
    .run();
}

/** Persist the context manifest + call stats of one answered turn. */
export function persistManifest(
  db: AppDatabase,
  turnId: string,
  meta: Pick<PassMeta, "promptVersion" | "latencyMs" | "salvage">,
  manifest: unknown,
  stats: unknown,
): void {
  const sectionsJson = JSON.stringify(manifest);
  db.insert(contextManifests)
    .values({
      id: randomUUID(),
      runId: null,
      turnId,
      promptVersion: meta.promptVersion,
      passId: "whatif",
      sectionsJson,
      totalBytes: Buffer.byteLength(sectionsJson, "utf8"),
      aiCallJson: JSON.stringify({ latencyMs: meta.latencyMs, salvage: meta.salvage }),
      verifiedStatsJson: JSON.stringify(stats),
      createdAt: new Date(),
    })
    .run();
}

/** Upsert the mechanical ledger of the session. */
export function persistLedger(
  db: AppDatabase,
  sessionId: string,
  ledger: ReturnType<typeof addTurnToLedger>,
  uptoTurn: number,
): void {
  const now = new Date();
  db.insert(sessionLedgers)
    .values({
      sessionId,
      uptoTurn,
      ledgerJson: JSON.stringify(ledger),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: sessionLedgers.sessionId,
      set: { uptoTurn, ledgerJson: JSON.stringify(ledger), updatedAt: now },
    })
    .run();
}

/** Tolerant read of a stored assistant-turn payload. */
function parseTurnData(raw: string): AssistantTurnData {
  try {
    const parsed = JSON.parse(raw) as Partial<AssistantTurnData>;
    return {
      answer: parsed.answer ?? null,
      contextCounts: parsed.contextCounts ?? null,
      error: typeof parsed.error === "string" ? parsed.error : null,
    };
  } catch {
    return { answer: null, contextCounts: null, error: null };
  }
}

function parseStringArray(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

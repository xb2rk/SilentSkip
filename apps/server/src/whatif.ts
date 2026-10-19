import { randomUUID } from "node:crypto";
import {
  addTurnToLedger,
  buildWhatIfContext,
  linkAnswer,
  type PassConfig,
  parseWhatIfLedger,
  runWhatIfPass,
  type WhatIfTurnInput,
  type WorkflowRunner,
} from "@silentskip/ai";
import {
  type AddPinRequest,
  AppError,
  type AssistantTurnData,
  ErrorCodes,
  type Pin,
  type StartWhatIfSessionRequest,
  type WhatIfAnswer,
  type WhatIfContextCounts,
  type WhatIfSessionDetailResponse,
  type WhatIfSessionSummary,
  type WhatIfStreamEvent,
  type WhatIfTurn,
  WORKTREE_REF,
} from "@silentskip/contracts";
import {
  type AppDatabase,
  contextManifests,
  pins,
  runs,
  sessionLedgers,
  sessions,
  turns,
} from "@silentskip/db";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { loadDigest } from "./digest-input";
import { loadProjectProfile } from "./profiles";
import { getProject } from "./projects";
import { SseChannel } from "./sse-channel";

/** Dependencies of the What-If manager (mirrors ReviewManager: injectable runner + config). */
export interface WhatIfManagerDeps {
  readonly db: AppDatabase;
  readonly log: Logger;
  readonly runner: WorkflowRunner;
  readonly config: PassConfig;
}

/** How many recent completed turns ride along with every question. */
const RECENT_TURN_LIMIT = 3;

/** How long completed SSE channels remain in memory for late replaying before eviction. */
const CHANNEL_RETENTION_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * What-If chat over one A/B comparison (E6, decision #28 mechanisms).
 *
 * Sessions are scoped to `projectId + baseRef + currentRef`; every question is answered by one
 * stateless call whose context is reconstructed mechanically (digest fact store + evidence pack
 * with pins/ledger anchors boosted + ledger + recent turns + latest report when present). The
 * answer passes the linker before it is persisted; every violation becomes a visible issue.
 */
export class WhatIfManager {
  private readonly channels = new Map<string, SseChannel<WhatIfStreamEvent>>();
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly deps: WhatIfManagerDeps) {}

  /** Sessions of one comparison (or of a project when refs are omitted), newest first. */
  listSessions(projectId: string, baseRef?: string, currentRef?: string): WhatIfSessionSummary[] {
    const filters = [eq(sessions.projectId, projectId)];
    if (baseRef !== undefined && baseRef !== "") filters.push(eq(sessions.baseRef, baseRef));
    if (currentRef !== undefined && currentRef !== "") {
      filters.push(eq(sessions.currentRef, currentRef));
    }
    const rows = this.deps.db
      .select({
        id: sessions.id,
        projectId: sessions.projectId,
        baseRef: sessions.baseRef,
        currentRef: sessions.currentRef,
        title: sessions.title,
        createdAt: sessions.createdAt,
        updatedAt: sessions.updatedAt,
      })
      .from(sessions)
      .where(and(...filters))
      .orderBy(desc(sessions.updatedAt))
      .limit(100)
      .all();

    if (rows.length === 0) return [];

    // Batch query turn counts in a single GROUP BY query instead of N+1 individual queries
    const sessionIds = rows.map((r) => r.id);
    const countRows = this.deps.db
      .select({
        sessionId: turns.sessionId,
        count: sql<number>`count(*)`,
      })
      .from(turns)
      .where(inArray(turns.sessionId, sessionIds))
      .groupBy(turns.sessionId)
      .all();
    const countMap = new Map(countRows.map((c) => [c.sessionId, c.count]));

    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      baseRef: row.baseRef ?? "",
      currentRef: row.currentRef ?? "",
      title: row.title,
      turnCount: countMap.get(row.id) ?? 0,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  /** Create a session bound to one A/B comparison. */
  createSession(input: StartWhatIfSessionRequest): WhatIfSessionDetailResponse {
    getProject(this.deps.db, input.projectId);
    this.assertRealBase(input.baseRef);
    const now = new Date();
    const row = {
      id: randomUUID(),
      projectId: input.projectId,
      runId: null,
      baseRef: input.baseRef,
      currentRef: input.currentRef,
      title: `${input.baseRef} → ${input.currentRef}`,
      createdAt: now,
      updatedAt: now,
    };
    this.deps.db.insert(sessions).values(row).run();
    return { session: this.summary(row, 0), turns: [] };
  }

  /** Session detail with its turns in order. */
  getSession(sessionId: string): WhatIfSessionDetailResponse {
    const row = this.sessionRow(sessionId);
    const turnRows = this.deps.db
      .select()
      .from(turns)
      .where(eq(turns.sessionId, sessionId))
      .orderBy(asc(turns.turnIndex))
      .all();
    return {
      session: this.summary(row, turnRows.length),
      turns: turnRows.map((turn) => this.projectTurn(turn)),
    };
  }

  /**
   * Accept one question: persist the user turn plus a pending assistant turn and start the
   * background answer. The returned id is the assistant turn whose stream the UI watches.
   */
  ask(sessionId: string, question: string): string {
    const session = this.sessionRow(sessionId);
    const baseRef = session.baseRef;
    const currentRef = session.currentRef;
    if (baseRef === null || currentRef === null) {
      throw new AppError(
        ErrorCodes.badRequest,
        "Phiên trò chuyện này không gắn với cặp so sánh A/B",
      );
    }
    const turnIndex = this.turnCount(sessionId);
    const now = new Date();
    this.deps.db
      .insert(turns)
      .values({
        id: randomUUID(),
        sessionId,
        turnIndex,
        role: "user",
        content: question,
        anchorsJson: null,
        pinsJson: null,
        contextManifestId: null,
        createdAt: now,
      })
      .run();
    const assistantTurnId = randomUUID();
    const pending: AssistantTurnData = { answer: null, contextCounts: null, error: null };
    this.deps.db
      .insert(turns)
      .values({
        id: assistantTurnId,
        sessionId,
        turnIndex: turnIndex + 1,
        role: "assistant",
        content: JSON.stringify(pending),
        anchorsJson: null,
        pinsJson: null,
        contextManifestId: null,
        createdAt: new Date(),
      })
      .run();
    this.deps.db
      .update(sessions)
      .set({ updatedAt: new Date() })
      .where(eq(sessions.id, sessionId))
      .run();

    const channel = new SseChannel<WhatIfStreamEvent>();
    this.channels.set(assistantTurnId, channel);
    const controller = new AbortController();
    this.controllers.set(assistantTurnId, controller);
    void this.execute(sessionId, assistantTurnId, question, baseRef, currentRef, controller).catch(
      (error: unknown) => {
        this.deps.log.error({ err: error }, "what-if turn crashed");
      },
    );
    return assistantTurnId;
  }

  /** Stream channel of one turn — replayable when the turn already finished. */
  channel(turnId: string): SseChannel<WhatIfStreamEvent> {
    const existing = this.channels.get(turnId);
    if (existing !== undefined) return existing;
    const channel = new SseChannel<WhatIfStreamEvent>();
    const row = this.turnRow(turnId);
    const data = this.parseTurnData(row.content);
    if (data.answer !== null) {
      void channel.emit({ type: "answer", turnId, answer: data.answer });
    } else if (data.error !== null) {
      void channel.emit({ type: "failed", turnId, error: data.error });
    } else {
      void channel.emit({
        type: "failed",
        turnId,
        error: "Không còn theo dõi được lượt này (server đã khởi động lại giữa chừng).",
      });
    }
    this.channels.set(turnId, channel);
    this.scheduleChannelEviction(turnId);
    return channel;
  }

  /** Pins of one comparison, newest first. */
  listPins(projectId: string, baseRef: string, currentRef: string): Pin[] {
    const rows = this.deps.db
      .select()
      .from(pins)
      .where(
        and(
          eq(pins.projectId, projectId),
          eq(pins.baseRef, baseRef),
          eq(pins.currentRef, currentRef),
        ),
      )
      .orderBy(desc(pins.createdAt))
      .all();
    return rows.map((row) => this.projectPin(row));
  }

  /**
   * Pin one anchor of the comparison. The anchor is validated against the live digest registry;
   * pinning an already-pinned anchor is idempotent and returns the existing pin.
   */
  async addPin(input: AddPinRequest): Promise<Pin> {
    const project = getProject(this.deps.db, input.projectId);
    this.assertRealBase(input.baseRef);
    const existing = this.deps.db
      .select()
      .from(pins)
      .where(
        and(
          eq(pins.projectId, input.projectId),
          eq(pins.baseRef, input.baseRef),
          eq(pins.currentRef, input.currentRef),
          eq(pins.anchorId, input.anchorId),
        ),
      )
      .get();
    if (existing !== undefined) return this.projectPin(existing);

    const digest = await loadDigest(
      project.rootPath,
      input.baseRef,
      input.currentRef,
      loadProjectProfile(this.deps.db, input.projectId),
    );
    if (!digest.anchors.some((anchor) => anchor.id === input.anchorId)) {
      throw new AppError(
        ErrorCodes.badRequest,
        `Anchor không tồn tại trong digest của cặp so sánh này: ${input.anchorId}`,
      );
    }
    const row = {
      id: randomUUID(),
      projectId: input.projectId,
      baseRef: input.baseRef,
      currentRef: input.currentRef,
      anchorId: input.anchorId,
      note: input.note ?? null,
      createdAt: new Date(),
    };
    this.deps.db.insert(pins).values(row).run();
    return this.projectPin(row);
  }

  /** Remove one pin. */
  removePin(pinId: string): void {
    const result = this.deps.db.delete(pins).where(eq(pins.id, pinId)).run();
    if (result.changes === 0) {
      throw new AppError(ErrorCodes.notFound, "Ghim không tồn tại");
    }
  }

  private async execute(
    sessionId: string,
    assistantTurnId: string,
    question: string,
    baseRef: string,
    currentRef: string,
    controller: AbortController,
  ): Promise<void> {
    const channel = this.channels.get(assistantTurnId);
    if (channel === undefined) return;
    const session = this.sessionRow(sessionId);
    const project = getProject(this.deps.db, session.projectId);
    const emitStage = async (
      stage: "context" | "ai" | "verify",
      state: "started" | "completed",
      latencyMs?: number,
    ): Promise<void> => {
      await channel.emit({
        type: "stage",
        stage,
        state,
        ...(latencyMs === undefined ? {} : { latencyMs }),
      });
    };

    try {
      const contextStartedAt = Date.now();
      await emitStage("context", "started");
      const digest = await loadDigest(
        project.rootPath,
        baseRef,
        currentRef,
        loadProjectProfile(this.deps.db, project.id),
      );
      const ledgerRow = this.deps.db
        .select()
        .from(sessionLedgers)
        .where(eq(sessionLedgers.sessionId, sessionId))
        .get();
      const ledger = parseWhatIfLedger(ledgerRow?.ledgerJson ?? null);
      const pinRows = this.deps.db
        .select()
        .from(pins)
        .where(
          and(
            eq(pins.projectId, session.projectId),
            eq(pins.baseRef, baseRef),
            eq(pins.currentRef, currentRef),
          ),
        )
        .all();
      const recentTurns = this.recentTurns(sessionId, assistantTurnId);
      const runSummary = this.latestRunReport(session.projectId, baseRef, currentRef);
      const context = buildWhatIfContext({
        digest,
        runSummary,
        ledger,
        recentTurns,
        pins: pinRows.map((row) => ({ anchorId: row.anchorId, note: row.note })),
        question,
      });
      await emitStage("context", "completed", Date.now() - contextStartedAt);

      await emitStage("ai", "started");
      const result = await runWhatIfPass(
        { runner: this.deps.runner, config: this.deps.config },
        context,
        controller.signal,
      );
      await emitStage("ai", "completed", result.meta.latencyMs);

      await emitStage("verify", "started");
      const linked = linkAnswer(result.output, context.factIndex);
      const usedAnchors = [...new Set(linked.answer.evidence.flatMap((item) => item.anchors))];
      const pinnedIds = new Set(pinRows.map((row) => row.anchorId));
      const answer: WhatIfAnswer = {
        ...linked.answer,
        pinsUsed: usedAnchors.filter((anchorId) => pinnedIds.has(anchorId)),
      };
      await emitStage("verify", "completed");

      const contextCounts: WhatIfContextCounts = {
        evidence: context.manifest.counts.evidence,
        pins: pinRows.length,
        turns: recentTurns.length,
      };
      const data: AssistantTurnData = { answer, contextCounts, error: null };
      this.persistTurn(assistantTurnId, data, usedAnchors, answer.pinsUsed);
      this.persistManifest(assistantTurnId, result.meta, context.manifest, linked.stats);
      this.persistLedger(
        sessionId,
        addTurnToLedger(ledger, {
          statement: answer.evidence.map((item) => item.statement),
          unknowns: answer.unknowns,
          anchors: usedAnchors,
        }),
        this.turnCount(sessionId) - 1,
      );
      this.deps.db
        .update(sessions)
        .set({ updatedAt: new Date() })
        .where(eq(sessions.id, sessionId))
        .run();

      this.scheduleChannelEviction(assistantTurnId);
      await channel.emit({ type: "answer", turnId: assistantTurnId, answer });
      this.deps.log.info(
        { sessionId, turnId: assistantTurnId, issues: linked.issues.length },
        "what-if turn completed",
      );
    } catch (error) {
      const message = controller.signal.aborted
        ? "Đã huỷ lượt hỏi."
        : error instanceof Error
          ? error.message
          : "what-if turn failed";
      const data: AssistantTurnData = { answer: null, contextCounts: null, error: message };
      this.persistTurn(assistantTurnId, data, [], []);
      this.scheduleChannelEviction(assistantTurnId);
      await channel.emit({ type: "failed", turnId: assistantTurnId, error: message });
      this.deps.log.warn({ err: error, sessionId }, "what-if turn failed");
    } finally {
      this.controllers.delete(assistantTurnId);
    }
  }

  /** Last completed (question, answer) pairs — reconstruction material for the next call. */
  private recentTurns(sessionId: string, excludeTurnId: string): WhatIfTurnInput[] {
    const rows = this.deps.db
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
      const data = this.parseTurnData(row.content);
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
  private latestRunReport(
    projectId: string,
    baseRef: string,
    currentRef: string,
  ): { verdict: string; qualityScore: number; report: unknown } | null {
    const row = this.deps.db
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

  private persistTurn(
    turnId: string,
    data: AssistantTurnData,
    anchors: readonly string[],
    pinsUsed: readonly string[],
  ): void {
    this.deps.db
      .update(turns)
      .set({
        content: JSON.stringify(data),
        anchorsJson: JSON.stringify(anchors),
        pinsJson: JSON.stringify(pinsUsed),
      })
      .where(eq(turns.id, turnId))
      .run();
  }

  private persistManifest(
    turnId: string,
    meta: { promptVersion: string; latencyMs: number; salvage: string },
    manifest: unknown,
    stats: unknown,
  ): void {
    const sectionsJson = JSON.stringify(manifest);
    this.deps.db
      .insert(contextManifests)
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

  private persistLedger(
    sessionId: string,
    ledger: ReturnType<typeof addTurnToLedger>,
    uptoTurn: number,
  ): void {
    const now = new Date();
    this.deps.db
      .insert(sessionLedgers)
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

  private assertRealBase(baseRef: string): void {
    if (baseRef === WORKTREE_REF) {
      throw new AppError(
        ErrorCodes.badRequest,
        "Bản gốc (A) phải là ref thật — không thể là bản đang làm",
      );
    }
  }

  private sessionRow(sessionId: string): typeof sessions.$inferSelect {
    const row = this.deps.db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
    if (row === undefined) {
      throw new AppError(ErrorCodes.notFound, "Phiên trò chuyện không tồn tại");
    }
    return row;
  }

  private turnRow(turnId: string): typeof turns.$inferSelect {
    const row = this.deps.db.select().from(turns).where(eq(turns.id, turnId)).get();
    if (row === undefined) {
      throw new AppError(ErrorCodes.notFound, "Lượt hỏi không tồn tại");
    }
    return row;
  }

  private summary(row: typeof sessions.$inferSelect, turnCount: number): WhatIfSessionSummary {
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

  private turnCount(sessionId: string): number {
    const row = this.deps.db
      .select({ value: sql<number>`count(*)` })
      .from(turns)
      .where(eq(turns.sessionId, sessionId))
      .get();
    return row?.value ?? 0;
  }

  private projectTurn(row: typeof turns.$inferSelect): WhatIfTurn {
    const anchors = this.parseStringArray(row.anchorsJson);
    const pinsUsed = this.parseStringArray(row.pinsJson);
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
    const data = this.parseTurnData(row.content);
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

  private parseTurnData(raw: string): AssistantTurnData {
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

  private parseStringArray(raw: string | null): string[] {
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

  private projectPin(row: typeof pins.$inferSelect): Pin {
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

  /**
   * Schedule channel deletion after TTL to prevent unbounded memory growth while
   * allowing connected clients to finish receiving replay events.
   */
  private scheduleChannelEviction(turnId: string): void {
    setTimeout(() => {
      this.channels.delete(turnId);
    }, CHANNEL_RETENTION_TTL_MS).unref?.();
  }
}

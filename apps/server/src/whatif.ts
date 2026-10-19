import { randomUUID } from "node:crypto";
import {
  addTurnToLedger,
  buildWhatIfContext,
  linkAnswer,
  type PassConfig,
  runWhatIfPass,
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
  WORKTREE_REF,
} from "@silentskip/contracts";
import { type AppDatabase, pins, sessions, turns } from "@silentskip/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Logger } from "pino";
import { scheduleChannelEviction } from "./channel-retention";
import { loadDigest } from "./digest-input";
import { loadProjectProfile } from "./profiles";
import { getProject } from "./projects";
import { SseChannel } from "./sse-channel";
import {
  countTurns,
  loadLatestRunReport,
  loadLedger,
  loadRecentTurns,
  persistLedger,
  persistManifest,
  persistTurn,
  projectPin,
  projectSessionSummary,
  projectTurn,
  readSessionRow,
  readTurnRow,
} from "./whatif-persistence";

/** Dependencies of the What-If manager (mirrors ReviewManager: injectable runner + config). */
export interface WhatIfManagerDeps {
  readonly db: AppDatabase;
  readonly log: Logger;
  readonly runner: WorkflowRunner;
  readonly config: PassConfig;
}

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
    return { session: projectSessionSummary(row, 0), turns: [] };
  }

  /** Session detail with its turns in order. */
  getSession(sessionId: string): WhatIfSessionDetailResponse {
    const row = readSessionRow(this.deps.db, sessionId);
    const turnRows = this.deps.db
      .select()
      .from(turns)
      .where(eq(turns.sessionId, sessionId))
      .orderBy(turns.turnIndex)
      .all();
    return {
      session: projectSessionSummary(row, turnRows.length),
      turns: turnRows.map((turn) => projectTurn(turn)),
    };
  }

  /**
   * Accept one question: persist the user turn plus a pending assistant turn and start the
   * background answer. The returned id is the assistant turn whose stream the UI watches.
   */
  ask(sessionId: string, question: string): string {
    const session = readSessionRow(this.deps.db, sessionId);
    const baseRef = session.baseRef;
    const currentRef = session.currentRef;
    if (baseRef === null || currentRef === null) {
      throw new AppError(
        ErrorCodes.badRequest,
        "Phiên trò chuyện này không gắn với cặp so sánh A/B",
      );
    }
    const turnIndex = countTurns(this.deps.db, sessionId);
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
    const row = readTurnRow(this.deps.db, turnId);
    const data = projectTurn(row);
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
    scheduleChannelEviction(this.channels, turnId);
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
    return rows.map((row) => projectPin(row));
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
    if (existing !== undefined) return projectPin(existing);

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
    return projectPin(row);
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
    const session = readSessionRow(this.deps.db, sessionId);
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
      const ledger = loadLedger(this.deps.db, sessionId);
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
      const recentTurns = loadRecentTurns(this.deps.db, sessionId, assistantTurnId);
      const runSummary = loadLatestRunReport(this.deps.db, session.projectId, baseRef, currentRef);
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
      persistTurn(this.deps.db, assistantTurnId, data, usedAnchors, answer.pinsUsed);
      persistManifest(this.deps.db, assistantTurnId, result.meta, context.manifest, linked.stats);
      persistLedger(
        this.deps.db,
        sessionId,
        addTurnToLedger(ledger, {
          statement: answer.evidence.map((item) => item.statement),
          unknowns: answer.unknowns,
          anchors: usedAnchors,
        }),
        countTurns(this.deps.db, sessionId) - 1,
      );
      this.deps.db
        .update(sessions)
        .set({ updatedAt: new Date() })
        .where(eq(sessions.id, sessionId))
        .run();

      scheduleChannelEviction(this.channels, assistantTurnId);
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
      persistTurn(this.deps.db, assistantTurnId, data, [], []);
      scheduleChannelEviction(this.channels, assistantTurnId);
      await channel.emit({ type: "failed", turnId: assistantTurnId, error: message });
      this.deps.log.warn({ err: error, sessionId }, "what-if turn failed");
    } finally {
      this.controllers.delete(assistantTurnId);
    }
  }

  private assertRealBase(baseRef: string): void {
    if (baseRef === WORKTREE_REF) {
      throw new AppError(
        ErrorCodes.badRequest,
        "Bản gốc (A) phải là ref thật — không thể là bản đang làm",
      );
    }
  }
}

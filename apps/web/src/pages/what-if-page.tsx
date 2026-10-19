import type { Anchor, WhatIfTurn } from "@silentskip/contracts";
import { WORKTREE_REF } from "@silentskip/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  Download,
  Loader2,
  MessageSquarePlus,
  Pin as PinIcon,
  PinOff,
  RotateCcw,
  Send,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { EvidenceDialog } from "@/components/report/evidence-dialog";
import { AnchorChip } from "@/components/report/finding-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { useProject } from "@/contexts/project-context";
import { formatDateTime } from "@/lib/format";
import { useDigest, useProjectRefs } from "@/lib/use-projects";
import {
  useAddPin,
  useAskWhatIf,
  useCreateWhatIfSession,
  usePins,
  useRemovePin,
  useWhatIfSession,
  useWhatIfSessions,
  useWhatIfStream,
} from "@/lib/use-whatif";

const SAMPLES = ["whatIf.sample1", "whatIf.sample2", "whatIf.sample3"] as const;
const STAGE_LABEL_KEYS = {
  context: "whatIf.stageContext",
  ai: "whatIf.stageAi",
  verify: "whatIf.stageVerify",
} as const;

/**
 * What-If Studio (E6): a simple chat that is scoped to one A/B comparison
 * (`projectId + baseRef + currentRef`) — conversations and pins belong to the comparison, not
 * to one run, and survive new sessions. Answers split into verified evidence (anchor chips →
 * evidence dialog, pinnable) and clearly-labelled speculation/unknowns. Numbers in answers are
 * rendered from engine facts on the server; this page never computes anything itself.
 */
export function WhatIfPage() {
  const { t } = useTranslation();
  const search = useSearch({ from: "/what-if" });
  const navigate = useNavigate();
  const { projects, activeProjectId } = useProject();

  const [projectId, setProjectId] = useState<string | null>(
    search.projectId ?? activeProjectId ?? null,
  );
  const [baseRef, setBaseRef] = useState<string | null>(search.base ?? null);
  const [currentRef, setCurrentRef] = useState<string | null>(search.current ?? null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [question, setQuestion] = useState(search.q ?? "");
  const [pendingTurnId, setPendingTurnId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const refsQuery = useProjectRefs(projectId);
  const scopeReady = projectId !== null && baseRef !== null && currentRef !== null;

  /**
   * Scope changes open a fresh conversation — sessions and pins are comparison-scoped.
   * The reset happens here (not in an effect) so biome's exhaustive-deps rule stays quiet.
   */
  function changeScope(next: {
    projectId?: string | null;
    baseRef?: string | null;
    currentRef?: string | null;
  }): void {
    if (next.projectId !== undefined) setProjectId(next.projectId);
    if (next.baseRef !== undefined) setBaseRef(next.baseRef);
    if (next.currentRef !== undefined) setCurrentRef(next.currentRef);
    setSessionId(null);
    setPendingTurnId(null);
  }

  // Sensible defaults once refs arrive: A = HEAD, B = WORKTREE (never for A).
  useEffect(() => {
    const refs = refsQuery.data;
    if (refs === undefined) return;
    if (baseRef === null && refs.head !== null) setBaseRef("HEAD");
    if (currentRef === null) setCurrentRef(WORKTREE_REF);
  }, [refsQuery.data, baseRef, currentRef]);

  // Deep link from "Hỏi về phần này" prefills the composer; a later link overrides it.
  useEffect(() => {
    if (search.q !== undefined) setQuestion(search.q);
  }, [search.q]);

  const sessionsQuery = useWhatIfSessions(projectId, baseRef, currentRef);
  const createSession = useCreateWhatIfSession();
  const sessionQuery = useWhatIfSession(sessionId);
  const ask = useAskWhatIf(sessionId);
  const stream = useWhatIfStream(pendingTurnId);
  const digestQuery = useDigest(projectId, baseRef, currentRef);
  const pinsQuery = usePins(projectId, baseRef, currentRef);
  const addPin = useAddPin(projectId, baseRef, currentRef);
  const removePin = useRemovePin();

  const anchorsById = useMemo(
    () => new Map((digestQuery.data?.anchors ?? []).map((item) => [item.id, item])),
    [digestQuery.data],
  );
  const pins = pinsQuery.data?.pins ?? [];
  const pinnedByAnchor = useMemo(() => new Map(pins.map((pin) => [pin.anchorId, pin])), [pins]);

  // The stream's terminal event ends the pending state; polling converges regardless.
  useEffect(() => {
    const terminal = stream.events.find((event) => event.type !== "stage");
    if (terminal !== undefined) setPendingTurnId(null);
  }, [stream.events]);

  // Polling is the convergence path: clear the send gate as soon as the pending turn is
  // resolved server-side, even if the SSE stream died mid-answer.
  useEffect(() => {
    if (pendingTurnId === null) return;
    const turn = sessionQuery.data?.turns.find((item) => item.id === pendingTurnId);
    if (turn !== undefined && (turn.answer !== null || turn.error !== null)) {
      setPendingTurnId(null);
    }
  }, [pendingTurnId, sessionQuery.data]);

  // Keep the comparison scope in the URL so refresh (and shared links) reopen the same pair.
  useEffect(() => {
    if (projectId === null || baseRef === null || currentRef === null) return;
    void navigate({
      to: "/what-if",
      replace: true,
      search: {
        projectId,
        base: baseRef,
        current: currentRef,
        ...(search.q !== undefined ? { q: search.q } : {}),
      },
    });
  }, [projectId, baseRef, currentRef, search.q, navigate]);

  // Follow the newest turn; the transcript itself scrolls, the composer stays in place.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these signals mean the transcript grew
  useEffect(() => {
    const element = transcriptRef.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, [sessionId, sessionQuery.data?.turns.length, pendingTurnId]);

  const lastStage = [...stream.events].reverse().find((event) => event.type === "stage");
  const stageLabel =
    lastStage !== undefined && lastStage.type === "stage"
      ? t(STAGE_LABEL_KEYS[lastStage.stage])
      : null;

  const refOptions = useMemo(() => {
    const refs = refsQuery.data;
    if (refs === undefined) return [];
    const names = refs.refs.map((ref) => ref.name);
    return refs.head === null ? names : ["HEAD", ...names];
  }, [refsQuery.data]);

  function handleNewSession(): void {
    if (!scopeReady || projectId === null || baseRef === null || currentRef === null) return;
    createSession.mutate(
      { projectId, baseRef, currentRef },
      {
        onSuccess: (detail) => setSessionId(detail.session.id),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  function openSession(id: string): void {
    setSessionId(id);
    setPendingTurnId(null);
  }

  function sendQuestion(text: string): void {
    const trimmed = text.trim();
    if (trimmed === "" || sessionId === null || pendingTurnId !== null || ask.isPending) return;
    ask.mutate(trimmed, {
      onSuccess: (turnId) => {
        setPendingTurnId(turnId);
        setQuestion("");
      },
      onError: (error) => toast.error(error.message),
    });
  }

  function handleAsk(): void {
    sendQuestion(question);
  }

  function handlePinToggle(anchorId: string): void {
    const existing = pinnedByAnchor.get(anchorId);
    if (existing !== undefined) {
      removePin.mutate(existing.id, { onError: (error) => toast.error(error.message) });
      return;
    }
    addPin.mutate(anchorId, {
      onSuccess: () => toast.success(t("whatIf.pinAdded")),
      onError: () => toast.error(t("whatIf.pinFailed")),
    });
  }

  function handleExport(): void {
    const detail = sessionQuery.data;
    if (detail === undefined) return;
    const lines: string[] = [
      `# What-If — ${detail.session.title}`,
      "",
      `- A: ${detail.session.baseRef}`,
      `- B: ${detail.session.currentRef}`,
      "",
    ];
    for (const turn of detail.turns) {
      if (turn.role === "user") {
        lines.push(`## ${t("whatIf.you")}`, "", turn.content, "");
        continue;
      }
      lines.push(`## ${t("whatIf.assistant")}`, "");
      if (turn.error !== null) {
        lines.push(`**${t("whatIf.aiError")}**: ${turn.error}`, "");
        continue;
      }
      if (turn.answer !== null) {
        lines.push(turn.answer.answer, "");
        if (turn.answer.evidence.length > 0) {
          lines.push(`### ${t("whatIf.evidenceTitle")}`, "");
          for (const item of turn.answer.evidence) {
            lines.push(`- ${item.statement} — ${item.anchors.join(", ")}`);
          }
          lines.push("");
        }
        if (turn.answer.speculation.length > 0) {
          lines.push(`### ${t("whatIf.speculationTitle")}`, "");
          for (const item of turn.answer.speculation) lines.push(`- ${item}`);
          lines.push("");
        }
        if (turn.answer.unknowns.length > 0) {
          lines.push(`### ${t("whatIf.unknownsTitle")}`, "");
          for (const item of turn.answer.unknowns) lines.push(`- ${item}`);
          lines.push("");
        }
        if (turn.contextCounts !== null) {
          lines.push(
            `_${t("whatIf.transparency", {
              evidence: turn.contextCounts.evidence,
              pins: turn.contextCounts.pins,
              turns: turn.contextCounts.turns,
            })}_`,
            "",
          );
        }
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `whatif-${detail.session.baseRef}-${detail.session.currentRef}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("whatIf.title")} description={t("whatIf.description")} />

      <Card className="surface">
        <CardHeader className="pb-3">
          <CardTitle className="text-body">{t("whatIf.scopeTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-meta">{t("whatIf.scopeProject")}</Label>
              <Select
                value={projectId ?? ""}
                onValueChange={(value) =>
                  changeScope({
                    projectId: value === "" ? null : value,
                    baseRef: null,
                    currentRef: null,
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("compare.projectPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-meta">{t("whatIf.scopeBase")}</Label>
              <Select
                value={baseRef ?? ""}
                onValueChange={(value) => changeScope({ baseRef: value === "" ? null : value })}
                disabled={projectId === null || refOptions.length === 0}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("compare.refPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {refOptions.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-meta">{t("whatIf.scopeCurrent")}</Label>
              <Select
                value={currentRef ?? ""}
                onValueChange={(value) => changeScope({ currentRef: value === "" ? null : value })}
                disabled={projectId === null || refOptions.length === 0}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("compare.refPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={WORKTREE_REF}>{t("compare.worktreeOption")}</SelectItem>
                  {refOptions.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {refsQuery.isError && (
            <div className="flex items-center gap-2">
              <p className="text-meta text-destructive">{t("whatIf.refsError")}</p>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-micro"
                onClick={() => void refsQuery.refetch()}
              >
                {t("common.retry")}
              </Button>
            </div>
          )}
          {refsQuery.data?.head === null && (
            <p className="text-meta text-muted-foreground">{t("compare.noCommits")}</p>
          )}
          <p className="text-meta text-muted-foreground">{t("whatIf.scopeHint")}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="space-y-3">
          <Card className="surface">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-body">{t("whatIf.sessionsTitle")}</CardTitle>
              <Button
                size="sm"
                variant="outline"
                disabled={!scopeReady || createSession.isPending}
                onClick={handleNewSession}
                aria-label={t("whatIf.newSession")}
              >
                <MessageSquarePlus className="size-3.5" />
                {t("whatIf.newSessionShort")}
              </Button>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {!scopeReady ? (
                <p className="text-meta text-muted-foreground">{t("whatIf.selectSessionFirst")}</p>
              ) : sessionsQuery.isError ? (
                <div className="space-y-2">
                  <p className="text-meta text-muted-foreground">{t("whatIf.sessionsError")}</p>
                  <Button size="sm" variant="outline" onClick={() => void sessionsQuery.refetch()}>
                    {t("common.retry")}
                  </Button>
                </div>
              ) : sessionsQuery.isPending ? (
                <div className="space-y-2">
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                </div>
              ) : (sessionsQuery.data?.sessions.length ?? 0) === 0 ? (
                <p className="text-meta text-muted-foreground">{t("whatIf.noSessions")}</p>
              ) : (
                sessionsQuery.data?.sessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => openSession(session.id)}
                    aria-current={session.id === sessionId ? "true" : undefined}
                    className={
                      session.id === sessionId
                        ? "w-full rounded-lg border border-primary/50 bg-primary/10 px-3 py-2 text-left"
                        : "w-full rounded-lg border border-border/60 px-3 py-2 text-left transition-colors hover:bg-accent/40"
                    }
                  >
                    <div className="truncate font-mono text-meta">{session.title}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-micro text-muted-foreground">
                      <span>{t("whatIf.turnCount", { count: session.turnCount })}</span>
                      <span>·</span>
                      <span>{formatDateTime(session.updatedAt)}</span>
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="surface">
            <CardHeader className="pb-2">
              <CardTitle className="text-body">{t("whatIf.pinsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {pinsQuery.isError ? (
                <div className="space-y-2">
                  <p className="text-meta text-muted-foreground">{t("whatIf.pinsError")}</p>
                  <Button size="sm" variant="outline" onClick={() => void pinsQuery.refetch()}>
                    {t("common.retry")}
                  </Button>
                </div>
              ) : pins.length === 0 ? (
                <p className="text-meta text-muted-foreground">{t("whatIf.noPins")}</p>
              ) : (
                pins.map((pin) => (
                  <div key={pin.id} className="flex items-center gap-2">
                    <AnchorChip
                      anchorId={pin.anchorId}
                      anchorsById={anchorsById}
                      onAnchorClick={setAnchor}
                      compact
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="px-1.5"
                      onClick={() => removePin.mutate(pin.id)}
                    >
                      <PinOff className="size-3.5" />
                      {t("whatIf.removePin")}
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="surface flex h-[70vh] max-h-[820px] min-h-[520px] flex-col">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-body">{t("whatIf.chatTitle")}</CardTitle>
            {sessionId !== null && (
              <Button
                size="sm"
                variant="outline"
                disabled={sessionQuery.isPending || sessionQuery.data === undefined}
                onClick={handleExport}
              >
                <Download className="size-3.5" />
                {t("whatIf.exportMd")}
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
            {sessionId === null ? (
              <EmptyState
                icon={Sparkles}
                title={t("whatIf.emptyTitle")}
                description={t("whatIf.emptyDescription")}
                action={
                  <div className="flex flex-col items-center gap-2">
                    <Button
                      onClick={handleNewSession}
                      disabled={!scopeReady || createSession.isPending}
                    >
                      <MessageSquarePlus className="size-4" />
                      {t("whatIf.newSession")}
                    </Button>
                    {!scopeReady && (
                      <p className="text-meta text-muted-foreground">
                        {t("whatIf.selectSessionFirst")}
                      </p>
                    )}
                  </div>
                }
              />
            ) : sessionQuery.isPending ? (
              <div className="space-y-3">
                <Skeleton className="h-16" />
                <Skeleton className="h-24" />
              </div>
            ) : (
              <div ref={transcriptRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                {(sessionQuery.data?.turns.length ?? 0) === 0 && (
                  <div className="flex flex-wrap justify-center gap-2 py-6">
                    {SAMPLES.map((key) => (
                      <Button
                        key={key}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="font-normal text-muted-foreground"
                        onClick={() => setQuestion(t(key))}
                      >
                        {t(key)}
                      </Button>
                    ))}
                  </div>
                )}
                {sessionQuery.data?.turns.map((turn, index, allTurns) => {
                  const previous = index > 0 ? allTurns[index - 1] : undefined;
                  return (
                    <TurnView
                      key={turn.id}
                      turn={turn}
                      anchorsById={anchorsById}
                      onAnchorClick={setAnchor}
                      pinnedByAnchor={pinnedByAnchor}
                      onPinToggle={handlePinToggle}
                      retryQuestion={
                        turn.role === "assistant" &&
                        turn.error !== null &&
                        previous?.role === "user"
                          ? previous.content
                          : null
                      }
                      onRetry={sendQuestion}
                    />
                  );
                })}
                {pendingTurnId !== null && (
                  <div className="flex items-center gap-2 text-meta text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    {stageLabel ?? t("whatIf.stageContext")}
                  </div>
                )}
              </div>
            )}

            <Separator />
            <div className="space-y-3">
              <Textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    handleAsk();
                  }
                }}
                placeholder={t("whatIf.composerPlaceholder")}
                className="min-h-16"
                disabled={sessionId === null}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-meta text-muted-foreground">
                  {sessionId === null ? t("whatIf.selectSessionFirst") : t("whatIf.composerHint")}
                </span>
                <Button
                  onClick={handleAsk}
                  disabled={
                    sessionId === null ||
                    question.trim() === "" ||
                    ask.isPending ||
                    pendingTurnId !== null
                  }
                >
                  {ask.isPending || pendingTurnId !== null ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  {t("whatIf.send")}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <EvidenceDialog
        anchor={anchor}
        onOpenChange={(open) => {
          if (!open) setAnchor(null);
        }}
      />
    </div>
  );
}

interface TurnViewProps {
  readonly turn: WhatIfTurn;
  readonly anchorsById: ReadonlyMap<string, Anchor>;
  readonly onAnchorClick: (anchor: Anchor) => void;
  readonly pinnedByAnchor: ReadonlyMap<string, { readonly id: string }>;
  readonly onPinToggle: (anchorId: string) => void;
  readonly retryQuestion: string | null;
  readonly onRetry: (question: string) => void;
}

/** One conversation turn — the user bubble or the structured assistant card. */
function TurnView({
  turn,
  anchorsById,
  onAnchorClick,
  pinnedByAnchor,
  onPinToggle,
  retryQuestion,
  onRetry,
}: TurnViewProps) {
  const { t } = useTranslation();

  function friendlyError(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes("timeout") || lower.includes("quá thời gian") || lower.includes("aborted")) {
      return t("whatIf.errorTimeout");
    }
    if (lower.includes("schema") || lower.includes("invalid") || lower.includes("parse")) {
      return t("whatIf.errorInvalid");
    }
    if (
      lower.includes("workflow") ||
      lower.includes("fetch") ||
      lower.includes("http") ||
      lower.includes("network")
    ) {
      return t("whatIf.errorUpstream");
    }
    return message;
  }

  const errorMessage = turn.error === null ? null : friendlyError(turn.error);

  if (turn.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="text-micro font-medium text-muted-foreground">{t("whatIf.you")}</span>
        <div className="max-w-[85%] rounded-xl border border-border/60 bg-muted/40 px-3.5 py-2.5 text-body leading-relaxed">
          {turn.content}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <span className="text-micro font-medium text-muted-foreground">{t("whatIf.assistant")}</span>
      <div className="space-y-3 rounded-xl border border-border/60 bg-card p-3.5">
        {turn.error !== null ? (
          <div className="flex items-start gap-2 text-body text-destructive">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-2">
              <div className="space-y-1">
                <div className="font-medium">{t("whatIf.aiError")}</div>
                <div className="text-muted-foreground">{errorMessage}</div>
                {errorMessage !== turn.error && (
                  <details className="text-micro text-muted-foreground">
                    <summary className="cursor-pointer">{t("whatIf.errorDetail")}</summary>
                    <code className="mt-1 block whitespace-pre-wrap break-words">{turn.error}</code>
                  </details>
                )}
              </div>
              {retryQuestion !== null && (
                <Button size="sm" variant="outline" onClick={() => onRetry(retryQuestion)}>
                  <RotateCcw className="size-3.5" />
                  {t("common.retry")}
                </Button>
              )}
            </div>
          </div>
        ) : turn.answer !== null ? (
          <>
            <p className="whitespace-pre-wrap text-body leading-relaxed">{turn.answer.answer}</p>

            {turn.answer.evidence.length > 0 && (
              <div className="space-y-2 rounded-lg border border-border/70 bg-muted/25 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-meta font-semibold">{t("whatIf.evidenceTitle")}</span>
                  <Badge variant="secondary" className="h-5 text-micro">
                    {t("whatIf.verifiedBadge")}
                  </Badge>
                </div>
                {turn.answer.evidence.map((item) => (
                  <div key={item.statement} className="space-y-1">
                    <div className="text-body leading-relaxed">{item.statement}</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {item.anchors.map((anchorId) => (
                        <span key={anchorId} className="inline-flex items-center gap-0.5">
                          <AnchorChip
                            anchorId={anchorId}
                            anchorsById={anchorsById}
                            onAnchorClick={onAnchorClick}
                          />
                          <Toggle
                            size="sm"
                            variant="outline"
                            pressed={pinnedByAnchor.has(anchorId)}
                            onPressedChange={() => onPinToggle(anchorId)}
                            aria-label={
                              pinnedByAnchor.has(anchorId) ? t("whatIf.pinned") : t("whatIf.pin")
                            }
                            title={
                              pinnedByAnchor.has(anchorId) ? t("whatIf.pinned") : t("whatIf.pin")
                            }
                            className="h-6 min-w-6 rounded-md px-1 data-[state=on]:text-primary"
                          >
                            <PinIcon className="size-3.5" />
                          </Toggle>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {turn.answer.speculation.length > 0 && (
              <div className="space-y-1.5 rounded-lg border border-warning/25 bg-warning/5 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-meta font-semibold uppercase tracking-wide text-warning dark:text-warning">
                    {t("whatIf.speculationTitle")}
                  </span>
                  <Badge variant="outline" className="h-5 text-micro">
                    {t("run.interpretationBadge")}
                  </Badge>
                </div>
                <ul className="list-disc space-y-1 pl-5 text-body leading-relaxed text-muted-foreground">
                  {turn.answer.speculation.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {turn.answer.unknowns.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-meta font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("whatIf.unknownsTitle")}
                </div>
                <ul className="list-disc space-y-1 pl-5 text-body leading-relaxed text-muted-foreground">
                  {turn.answer.unknowns.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {turn.contextCounts !== null && (
              <p className="text-meta text-muted-foreground">
                {t("whatIf.transparency", {
                  evidence: turn.contextCounts.evidence,
                  pins: turn.contextCounts.pins,
                  turns: turn.contextCounts.turns,
                })}
              </p>
            )}
          </>
        ) : (
          <div className="flex items-center gap-2 text-meta text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {t("whatIf.stageContext")}
          </div>
        )}
      </div>
    </div>
  );
}

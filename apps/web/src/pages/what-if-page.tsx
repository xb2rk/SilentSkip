import type { Anchor, WhatIfTurn } from "@craftland-qa/contracts";
import { WORKTREE_REF } from "@craftland-qa/contracts";
import { useSearch } from "@tanstack/react-router";
import {
  Download,
  Info,
  Loader2,
  MessageSquarePlus,
  Pin as PinIcon,
  PinOff,
  Send,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { EvidenceDialog } from "@/components/report/evidence-dialog";
import { AnchorChip } from "@/components/report/finding-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
  const { projects, activeProjectId } = useProject();

  const [projectId, setProjectId] = useState<string | null>(
    search.projectId ?? activeProjectId ?? null,
  );
  const [baseRef, setBaseRef] = useState<string | null>(search.base ?? null);
  const [currentRef, setCurrentRef] = useState<string | null>(search.current ?? null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [pendingTurnId, setPendingTurnId] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

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

  function handleAsk(): void {
    const trimmed = question.trim();
    if (trimmed === "" || sessionId === null || pendingTurnId !== null) return;
    ask.mutate(trimmed, {
      onSuccess: (turnId) => {
        setPendingTurnId(turnId);
        setQuestion("");
      },
      onError: (error) => toast.error(error.message),
    });
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-[13px]">{t("whatIf.scopeTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-[12px]">{t("whatIf.scopeProject")}</Label>
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
              <Label className="text-[12px]">{t("whatIf.scopeBase")}</Label>
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
              <Label className="text-[12px]">{t("whatIf.scopeCurrent")}</Label>
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
          <p className="text-[11.5px] text-muted-foreground">{t("whatIf.scopeHint")}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold">{t("whatIf.sessionsTitle")}</h2>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={!scopeReady || createSession.isPending}
              onClick={handleNewSession}
            >
              <MessageSquarePlus className="size-3.5" />
              {t("whatIf.newSession")}
            </Button>
          </div>
          {!scopeReady ? (
            <p className="text-[12px] text-muted-foreground">{t("whatIf.selectSessionFirst")}</p>
          ) : sessionsQuery.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : (sessionsQuery.data?.sessions.length ?? 0) === 0 ? (
            <p className="text-[12px] text-muted-foreground">{t("whatIf.noSessions")}</p>
          ) : (
            <div className="space-y-1.5">
              {sessionsQuery.data?.sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => setSessionId(session.id)}
                  className={
                    session.id === sessionId
                      ? "w-full rounded-lg border border-primary/50 bg-primary/10 px-3 py-2 text-left"
                      : "w-full rounded-lg border border-border/60 px-3 py-2 text-left transition-colors hover:bg-accent/40"
                  }
                >
                  <div className="truncate font-mono text-[11.5px]">{session.title}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-muted-foreground">
                    <span>{t("whatIf.turnCount", { count: session.turnCount })}</span>
                    <span>·</span>
                    <span>{formatDateTime(session.updatedAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-[12.5px]">{t("whatIf.pinsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {pins.length === 0 ? (
                <p className="text-[11.5px] text-muted-foreground">{t("whatIf.noPins")}</p>
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
                      className="h-6 px-1.5 text-[11px]"
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

        <Card className="flex min-h-[420px] flex-col">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-[13px]">{t("whatIf.title")}</CardTitle>
            {sessionId !== null && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={sessionQuery.isPending}
                onClick={handleExport}
              >
                <Download className="size-3.5" />
                {t("whatIf.exportMd")}
              </Button>
            )}
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4">
            {sessionId === null ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
                <div className="flex size-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                  <Sparkles className="size-5" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold">{t("whatIf.emptyTitle")}</h2>
                  <p className="mx-auto max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
                    {t("whatIf.emptyDescription")}
                  </p>
                </div>
              </div>
            ) : sessionQuery.isPending ? (
              <div className="space-y-3">
                <Skeleton className="h-16" />
                <Skeleton className="h-24" />
              </div>
            ) : (
              <div className="flex-1 space-y-4">
                {(sessionQuery.data?.turns.length ?? 0) === 0 && (
                  <div className="flex flex-wrap justify-center gap-2 py-6">
                    {SAMPLES.map((key) => (
                      <Button
                        key={key}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 rounded-full px-3 text-xs font-normal text-muted-foreground"
                        onClick={() => setQuestion(t(key))}
                      >
                        {t(key)}
                      </Button>
                    ))}
                  </div>
                )}
                {sessionQuery.data?.turns.map((turn) => (
                  <TurnView
                    key={turn.id}
                    turn={turn}
                    anchorsById={anchorsById}
                    onAnchorClick={setAnchor}
                    pinnedByAnchor={pinnedByAnchor}
                    onPinToggle={handlePinToggle}
                  />
                ))}
                {pendingTurnId !== null && (
                  <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    {stageLabel ?? t("whatIf.stageContext")}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3 border-t border-border/60 pt-4">
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
                className="min-h-20"
                disabled={sessionId === null}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-muted-foreground">
                  {t("whatIf.composerHint")}
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

      <Alert>
        <Info className="size-4" />
        <AlertDescription>{t("whatIf.description")}</AlertDescription>
      </Alert>

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
}

/** One conversation turn — the user bubble or the structured assistant card. */
function TurnView({
  turn,
  anchorsById,
  onAnchorClick,
  pinnedByAnchor,
  onPinToggle,
}: TurnViewProps) {
  const { t } = useTranslation();

  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-xl border border-border/60 bg-muted/40 px-3.5 py-2.5 text-[13px] leading-relaxed">
          {turn.content}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/60 p-3.5">
      {turn.error !== null ? (
        <div className="flex items-start gap-2 text-[12.5px] text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-medium">{t("whatIf.aiError")}</div>
            <div className="text-muted-foreground">{turn.error}</div>
          </div>
        </div>
      ) : turn.answer !== null ? (
        <>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{turn.answer.answer}</p>

          {turn.answer.evidence.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("whatIf.evidenceTitle")}
              </div>
              {turn.answer.evidence.map((item) => (
                <div key={item.statement} className="space-y-1">
                  <div className="text-[12.5px] leading-relaxed">{item.statement}</div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {item.anchors.map((anchorId) => (
                      <span key={anchorId} className="inline-flex items-center gap-0.5">
                        <AnchorChip
                          anchorId={anchorId}
                          anchorsById={anchorsById}
                          onAnchorClick={onAnchorClick}
                          compact
                        />
                        <button
                          type="button"
                          title={
                            pinnedByAnchor.has(anchorId) ? t("whatIf.pinned") : t("whatIf.pin")
                          }
                          onClick={() => onPinToggle(anchorId)}
                          className={
                            pinnedByAnchor.has(anchorId)
                              ? "text-primary"
                              : "text-muted-foreground/60 transition-colors hover:text-foreground"
                          }
                        >
                          <PinIcon className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {turn.answer.speculation.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[11.5px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                  {t("whatIf.speculationTitle")}
                </span>
                <Badge variant="outline" className="h-5 text-[10px]">
                  {t("run.interpretationBadge")}
                </Badge>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-muted-foreground">
                {turn.answer.speculation.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {turn.answer.unknowns.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("whatIf.unknownsTitle")}
              </div>
              <ul className="list-disc space-y-1 pl-5 text-[12.5px] leading-relaxed text-muted-foreground">
                {turn.answer.unknowns.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {turn.contextCounts !== null && (
            <p className="text-[11px] text-muted-foreground/80">
              {t("whatIf.transparency", {
                evidence: turn.contextCounts.evidence,
                pins: turn.contextCounts.pins,
                turns: turn.contextCounts.turns,
              })}
            </p>
          )}
        </>
      ) : (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t("whatIf.stageContext")}
        </div>
      )}
    </div>
  );
}

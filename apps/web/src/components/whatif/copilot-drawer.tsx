import { type Anchor, WORKTREE_REF } from "@silentskip/contracts";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { ExternalLink, Loader2, MessageSquarePlus, Send, Sparkles, User } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { EvidenceDialog } from "@/components/report/evidence-dialog";
import { AnchorChip } from "@/components/report/finding-card";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useCopilot } from "@/contexts/copilot-context";
import { useProject } from "@/contexts/project-context";
import { useDigest, useProjectRefs } from "@/lib/use-projects";
import {
  useAskWhatIf,
  useCreateWhatIfSession,
  useWhatIfSession,
  useWhatIfSessions,
  useWhatIfStream,
} from "@/lib/use-whatif";

const SAMPLE_PROMPTS = [
  "Giải thích tại sao cấu hình này lại bị silent skip?",
  "Thay đổi giá trị này có làm ảnh hưởng logic runtime không?",
  "Cần viết test case nào cho thay đổi này?",
] as const;

export function CopilotDrawer() {
  const { t } = useTranslation();
  const { isOpen, closeCopilot, options } = useCopilot();
  const { activeProject, activeProjectId } = useProject();

  const projectId = options?.projectId ?? activeProjectId ?? null;
  const refsQuery = useProjectRefs(projectId);

  const [baseRef, setBaseRef] = useState<string>("HEAD");
  const [currentRef, setCurrentRef] = useState<string>(WORKTREE_REF);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [pendingTurnId, setPendingTurnId] = useState<string | null>(null);
  const [activeAnchor, setActiveAnchor] = useState<Anchor | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (options?.baseRef) setBaseRef(options.baseRef);
    if (options?.currentRef) setCurrentRef(options.currentRef);
    if (options?.initialQuestion) setQuestion(options.initialQuestion);
  }, [options]);

  useEffect(() => {
    const refs = refsQuery.data;
    if (!refs) return;
    if (!options?.baseRef && refs.head !== null) setBaseRef("HEAD");
    if (!options?.currentRef) setCurrentRef(WORKTREE_REF);
  }, [refsQuery.data, options]);

  const sessionsQuery = useWhatIfSessions(projectId, baseRef, currentRef);
  const createSession = useCreateWhatIfSession();
  const sessionQuery = useWhatIfSession(sessionId);
  const ask = useAskWhatIf(sessionId);
  const stream = useWhatIfStream(pendingTurnId);
  const digestQuery = useDigest(projectId, baseRef, currentRef);

  const anchorsById = useMemo(
    () => new Map((digestQuery.data?.anchors ?? []).map((item) => [item.id, item])),
    [digestQuery.data],
  );

  // Auto-select latest session or create one when opened
  useEffect(() => {
    if (!isOpen || !projectId) return;
    const existing = sessionsQuery.data?.sessions ?? [];
    if (sessionId === null) {
      if (existing.length > 0) {
        setSessionId(existing[0]?.id ?? null);
      } else if (!createSession.isPending) {
        createSession.mutate(
          { projectId, baseRef, currentRef },
          {
            onSuccess: (res) => setSessionId(res.session.id),
          },
        );
      }
    }
  }, [isOpen, projectId, baseRef, currentRef, sessionsQuery.data, sessionId, createSession]);

  // Terminal event completes stream
  useEffect(() => {
    const terminal = stream.events.find((event) => event.type !== "stage");
    if (terminal !== undefined) setPendingTurnId(null);
  }, [stream.events]);

  // Scroll transcript to bottom on new turns
  useEffect(() => {
    if (
      transcriptRef.current &&
      (sessionQuery.data?.turns !== undefined || stream.events.length > 0)
    ) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [sessionQuery.data?.turns, stream.events]);

  function handleSend(): void {
    const trimmed = question.trim();
    if (!trimmed || !sessionId || pendingTurnId !== null) return;

    setQuestion("");
    ask.mutate(trimmed, {
      onSuccess: (turnId) => setPendingTurnId(turnId),
      onError: () => toast.error(t("whatIf.sendFailed")),
    });
  }

  function handleNewSession(): void {
    if (!projectId) return;
    createSession.mutate(
      { projectId, baseRef, currentRef },
      {
        onSuccess: (res) => {
          setSessionId(res.session.id);
          setPendingTurnId(null);
          toast.success("Đã tạo phiên hỏi đáp mới");
        },
      },
    );
  }

  const turns = sessionQuery.data?.turns ?? [];
  const isBusy = pendingTurnId !== null;

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => !open && closeCopilot()}>
        <SheetContent
          side="right"
          className="flex h-full w-full flex-col p-0 sm:max-w-md md:max-w-lg lg:max-w-xl border-l border-border/70 bg-background shadow-2xl"
        >
          {/* Header */}
          <SheetHeader className="flex flex-row items-center justify-between border-b border-border/50 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Sparkles className="size-4" />
              </div>
              <div>
                <SheetTitle className="text-body-lg font-bold">SilentSkip Copilot</SheetTitle>
                <p className="text-micro text-muted-foreground truncate max-w-[260px]">
                  {activeProject?.name ?? "Dự án"} · {baseRef} ➔ {currentRef}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-foreground"
                title="Tạo phiên chat mới"
                onClick={handleNewSession}
                disabled={createSession.isPending}
              >
                <MessageSquarePlus className="size-4" />
              </Button>
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-foreground"
                title="Mở trang What-If đầy đủ"
              >
                <Link
                  to="/what-if"
                  search={{
                    base: baseRef,
                    current: currentRef,
                    ...(projectId ? { projectId } : {}),
                  }}
                  onClick={closeCopilot}
                >
                  <ExternalLink className="size-4" />
                </Link>
              </Button>
            </div>
          </SheetHeader>

          {/* Transcript Message Area */}
          <div ref={transcriptRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {turns.length === 0 && !isBusy && (
              <div className="flex flex-col items-center justify-center h-full py-12 text-center text-muted-foreground space-y-3">
                <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Sparkles className="size-6" />
                </div>
                <div className="space-y-1">
                  <p className="text-body font-semibold text-foreground">
                    Hỏi bất cứ điều gì về bản so sánh
                  </p>
                  <p className="text-meta max-w-xs">
                    Copilot sẽ tra cứu toàn bộ AST code, file CSV và phân tích tác động trực tiếp.
                  </p>
                </div>
                <div className="flex flex-col gap-2 pt-2 w-full max-w-sm">
                  {SAMPLE_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => setQuestion(prompt)}
                      className="rounded-lg border border-border/70 bg-card p-2.5 text-left text-meta text-muted-foreground transition-all hover:border-primary/40 hover:text-foreground hover:bg-muted/40"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((turn) => (
              <div
                key={turn.id}
                className={cn(
                  "flex flex-col gap-1.5",
                  turn.role === "user" ? "items-end" : "items-start",
                )}
              >
                <div className="flex items-center gap-1.5 text-micro text-muted-foreground px-1">
                  {turn.role === "user" ? (
                    <>
                      <span>Bạn</span>
                      <User className="size-3" />
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-3 text-primary" />
                      <span className="font-medium text-foreground">Copilot</span>
                    </>
                  )}
                </div>

                <div
                  className={cn(
                    "rounded-xl px-4 py-3 text-body leading-relaxed max-w-[90%]",
                    turn.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-xs"
                      : "surface rounded-bl-xs bg-card",
                  )}
                >
                  {turn.role === "user" ? (
                    <p className="whitespace-pre-wrap">{turn.content}</p>
                  ) : turn.answer !== null ? (
                    <div className="space-y-2.5">
                      <p className="whitespace-pre-wrap">{turn.answer.answer}</p>

                      {turn.answer.speculation.length > 0 && (
                        <div className="rounded-lg border border-warning/30 bg-warning/5 p-2 text-meta text-warning-foreground">
                          <span className="font-semibold text-warning">Dự đoán logic: </span>
                          {turn.answer.speculation.join(" · ")}
                        </div>
                      )}

                      {turn.answer.evidence.length > 0 && (
                        <div className="pt-1">
                          <p className="text-micro font-medium text-muted-foreground mb-1.5">
                            Dẫn chứng trích xuất:
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {turn.answer.evidence
                              .flatMap((ev) => ev.anchors)
                              .map((anchorId: string) => (
                                <AnchorChip
                                  key={anchorId}
                                  anchorId={anchorId}
                                  anchorsById={anchorsById}
                                  onAnchorClick={setActiveAnchor}
                                />
                              ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : turn.error !== null ? (
                    <p className="text-destructive text-meta">{turn.error}</p>
                  ) : (
                    <div className="flex items-center gap-2 text-meta text-muted-foreground py-1">
                      <Loader2 className="size-4 animate-spin text-primary" />
                      <span>Đang suy nghĩ và đối chiếu mã nguồn...</span>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isBusy && (
              <div className="flex items-center gap-2 text-meta text-muted-foreground py-2 px-1">
                <Loader2 className="size-4 animate-spin text-primary" />
                <span>AI đang đọc AST và tổng hợp câu trả lời...</span>
              </div>
            )}
          </div>

          {/* Prompt composer */}
          <div className="border-t border-border/50 p-3 bg-muted/20 space-y-2">
            <div className="relative flex items-end rounded-xl border border-border/70 bg-background shadow-xs focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/40">
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Hỏi về thay đổi, code hoặc file config này... (Enter gửi)"
                rows={2}
                disabled={isBusy}
                className="resize-none border-0 shadow-none focus-visible:ring-0 text-body p-3 min-h-[58px]"
              />
              <div className="p-2 shrink-0">
                <Button
                  size="icon"
                  className="size-8 rounded-lg"
                  disabled={!question.trim() || isBusy}
                  onClick={handleSend}
                >
                  <Send className="size-4" />
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between text-micro text-muted-foreground px-1">
              <span>Nhấn Enter để gửi · Shift+Enter để xuống dòng</span>
              <span>Dữ liệu chạy cục bộ</span>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Floating Evidence Dialog */}
      <EvidenceDialog
        anchor={activeAnchor}
        onOpenChange={(open) => {
          if (!open) setActiveAnchor(null);
        }}
      />
    </>
  );
}

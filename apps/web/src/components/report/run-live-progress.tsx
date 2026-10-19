import type { ReviewStreamEvent } from "@silentskip/contracts";
import { cn } from "cn";
import {
  Ban,
  BookOpen,
  Boxes,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  FileSearch,
  Lightbulb,
  Loader2,
  Microscope,
  Terminal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration } from "@/lib/format";
import { STAGE_ORDER, type StageName, stageStates, stageTotals } from "@/lib/stage-progress";

const STAGE_LABEL_KEYS: Record<StageName, string> = {
  digest: "run.stageDigest",
  map: "run.stageMap",
  read: "run.stageRead",
  dig: "run.stageDig",
  synthesize: "run.stageSynthesize",
};

const STAGE_HINT_KEYS: Record<StageName, string> = {
  digest: "run.stageDigestHint",
  map: "run.stageMapHint",
  read: "run.stageReadHint",
  dig: "run.stageDigHint",
  synthesize: "run.stageSynthesizeHint",
};

const STAGE_ICONS: Record<StageName, typeof FileSearch> = {
  digest: FileSearch,
  map: Boxes,
  read: BookOpen,
  dig: Microscope,
  synthesize: BrainCircuit,
};

const PRO_TIPS = [
  "Mẹo: Bạn có thể nhấn Ctrl + / bất kỳ lúc nào để mở Copilot Drawer hỏi về mã nguồn mà không cần rời trang.",
  "SilentSkip đối chiếu chéo mọi trích dẫn (anchors) với AST mã nguồn để triệt tiêu hiện tượng AI bịa đặt.",
  "Lớp Engine phân tích tĩnh chạy trước AI để phát hiện ngay các lỗi cú pháp và thiếu khoá CSV.",
  "Nhấn nút 'Hủy chạy' sẽ giữ lại các phân tích từng phần đã thực hiện mà không làm mất dữ liệu.",
  "Nhấn Ctrl + K trên bàn phím để mở thanh tìm kiếm nhanh các dự án và điều hướng tức thì.",
];

interface RunLiveProgressProps {
  readonly runId: string;
  readonly status: "queued" | "running";
  readonly elapsedMs: number;
  readonly events: readonly ReviewStreamEvent[];
  readonly streamError: boolean;
  readonly onCancel: () => void;
  readonly isCancelling: boolean;
}

export function RunLiveProgress({
  runId,
  status,
  elapsedMs,
  events,
  streamError,
  onCancel,
  isCancelling,
}: RunLiveProgressProps) {
  const { t } = useTranslation();
  const states = stageStates(events);
  const totals = stageTotals(states);
  const [tipIndex, setTipIndex] = useState(0);
  const [copiedLog, setCopiedLog] = useState(false);
  const [showConsole, setShowConsole] = useState(true);
  const terminalEndRef = useRef<HTMLDivElement | null>(null);

  // Rotate tips every 6s
  useEffect(() => {
    const timer = window.setInterval(() => {
      setTipIndex((prev) => (prev + 1) % PRO_TIPS.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, []);

  // Compute overall progress percentage
  const progressPercent = useMemo(() => {
    let completedCount = 0;
    for (const stage of STAGE_ORDER) {
      if (states[stage].state === "done") completedCount += 1;
    }
    const readState = states.read;
    let readFraction = 0;
    if (readState.units !== undefined && readState.units > 0) {
      readFraction = (readState.doneRegions ?? 0) / readState.units;
    }
    if (completedCount === 5) return 100;
    if (states.read.state === "active") {
      return Math.min(85, Math.round(20 + 20 + readFraction * 35));
    }
    if (completedCount === 0) return 10;
    if (completedCount === 1) return 30;
    if (completedCount === 2) return 50;
    if (completedCount === 3) return 75;
    return 90;
  }, [states]);

  interface ConsoleLogEntry {
    readonly id: string;
    readonly text: string;
    readonly time: string;
  }

  // Keep timestamp fixed at the exact moment each entry is first recorded
  const logTimestampsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    logTimestampsRef.current.clear();
  }, [runId]);

  const getLogTime = (id: string): string => {
    let tStr = logTimestampsRef.current.get(id);
    if (!tStr) {
      tStr = new Date().toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      logTimestampsRef.current.set(id, tStr);
    }
    return tStr;
  };

  // Generate logs from events with fixed append-time timestamps
  const consoleLogs = useMemo<readonly ConsoleLogEntry[]>(() => {
    const logs: ConsoleLogEntry[] = [
      {
        id: "init",
        text: "⚡ SilentSkip Review Engine khởi tạo kết nối SSE...",
        time: getLogTime("init"),
      },
    ];
    let idx = 0;
    for (const ev of events) {
      idx += 1;
      if (ev.type === "stage") {
        const stageName = t(STAGE_LABEL_KEYS[ev.stage]);
        if (ev.state === "started") {
          let extra = "";
          if (ev.unit !== undefined && ev.units !== undefined) {
            extra = ` [Unit ${ev.unit}/${ev.units}]`;
          }
          if (ev.chunk !== undefined && ev.chunks !== undefined && ev.chunks > 1) {
            extra += ` (chunk ${ev.chunk}/${ev.chunks})`;
          }
          const id = `stage-${ev.stage}-started-${idx}`;
          logs.push({
            id,
            text: `▶ [${ev.stage.toUpperCase()}] Bắt đầu: ${stageName}${extra}`,
            time: getLogTime(id),
          });
        } else if (ev.state === "completed") {
          const lat = ev.latencyMs !== undefined ? ` (${formatDuration(ev.latencyMs)})` : "";
          const id = `stage-${ev.stage}-completed-${idx}`;
          logs.push({
            id,
            text: `✓ [${ev.stage.toUpperCase()}] Hoàn tất: ${stageName}${lat}`,
            time: getLogTime(id),
          });
        }
      } else if (ev.type === "completed") {
        const id = `completed-${idx}`;
        logs.push({
          id,
          text: `🎉 Hoàn thành lượt chạy! Kết quả: ${ev.verdict} - Điểm: ${ev.qualityScore}/100`,
          time: getLogTime(id),
        });
      } else if (ev.type === "failed") {
        const id = `failed-${idx}`;
        logs.push({
          id,
          text: `❌ Lỗi trong quá trình chạy: ${ev.error}`,
          time: getLogTime(id),
        });
      } else if (ev.type === "cancelled") {
        const id = `cancelled-${idx}`;
        logs.push({
          id,
          text: "⏹ Lượt chạy đã được hủy bỏ.",
          time: getLogTime(id),
        });
      }
    }
    return logs;
  }, [events, t, runId]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalEndRef.current && showConsole && consoleLogs.length > 0) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [consoleLogs.length, showConsole]);

  function handleCopyLogs(): void {
    void navigator.clipboard.writeText(consoleLogs.map((l) => l.text).join("\n")).then(() => {
      setCopiedLog(true);
      setTimeout(() => setCopiedLog(false), 2000);
    });
  }

  // Format stopwatch 00:00
  const elapsedSec = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(elapsedSec / 60);
  const seconds = elapsedSec % 60;
  const timeFormatted = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  return (
    <Card className="surface overflow-hidden border-primary/30 shadow-lg">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b border-border/50 bg-muted/20 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex size-3 items-center justify-center">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </div>
          <CardTitle className="text-base font-bold text-foreground">
            {status === "queued" ? t("run.statusQueued") : t("run.statusRunning")}
          </CardTitle>
          <span className="rounded-md border border-border/70 bg-background/80 px-2 py-0.5 font-mono text-meta font-semibold tabular-nums text-foreground">
            ⏱ {timeFormatted}
          </span>
          <span className="text-meta text-muted-foreground tabular-nums">
            {totals.calls > 0 && `${totals.calls} AI calls · `}
            {totals.totalMs > 0 && `Độ trễ AI: ${formatDuration(totals.totalMs)}`}
          </span>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isCancelling}
          className="border-danger/30 text-danger hover:bg-danger/10"
          title={t("run.cancelKeepsPartial")}
          onClick={onCancel}
        >
          <Ban className="size-3.5" />
          {isCancelling ? t("run.cancelling") : t("run.cancelRun")}
        </Button>
      </CardHeader>

      <CardContent className="space-y-6 p-5">
        {/* Animated Progress Bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-meta">
            <span className="font-medium text-foreground">Tiến độ quy trình kiểm định</span>
            <span className="font-mono font-bold tabular-nums text-primary">
              {progressPercent}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted/50">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary via-indigo-500 to-emerald-500 transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* 5-Stage Visual Stepper */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
          {STAGE_ORDER.map((stage, idx) => {
            const state = states[stage];
            const Icon = STAGE_ICONS[stage];
            const isDone = state.state === "done";
            const isActive = state.state === "active";
            const isPending = state.state === "pending";

            return (
              <div
                key={stage}
                className={cn(
                  "relative flex flex-col justify-between rounded-xl border p-3.5 transition-all duration-300",
                  isDone && "border-emerald-500/30 bg-emerald-500/5",
                  isActive && "border-primary bg-primary/10 shadow-sm ring-1 ring-primary/40",
                  isPending && "border-border/50 bg-muted/10 opacity-60",
                )}
                title={t(STAGE_HINT_KEYS[stage])}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-micro font-bold text-muted-foreground">
                      0{idx + 1}
                    </span>
                    {isDone ? (
                      <CheckCircle2 className="size-4 text-emerald-500" />
                    ) : isActive ? (
                      <Loader2 className="size-4 animate-spin text-primary" />
                    ) : (
                      <span className="size-2 rounded-full bg-muted-foreground/30" />
                    )}
                  </div>

                  <div className="mt-2.5 flex items-center gap-2">
                    <Icon
                      className={cn(
                        "size-4 shrink-0",
                        isDone && "text-emerald-500",
                        isActive && "text-primary",
                        isPending && "text-muted-foreground",
                      )}
                    />
                    <span className="truncate text-body font-bold text-foreground">
                      {t(STAGE_LABEL_KEYS[stage])}
                    </span>
                  </div>
                </div>

                <div className="mt-3 border-t border-border/40 pt-2 text-micro">
                  {isDone ? (
                    <span className="font-mono font-medium text-emerald-600 dark:text-emerald-400">
                      {state.totalMs > 0 ? formatDuration(state.totalMs) : "Xong"}
                    </span>
                  ) : isActive ? (
                    <span className="font-medium text-primary animate-pulse">
                      {stage === "read" && state.units !== undefined
                        ? `Unit ${state.doneRegions ?? 0}/${state.units}`
                        : "Đang xử lý..."}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Chờ</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Live Terminal Telemetry Console */}
        <div className="overflow-hidden rounded-xl border border-border/70 bg-zinc-950 font-mono text-xs text-zinc-300 shadow-inner dark:bg-black/80">
          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-4 py-2">
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5">
                <span className="size-2.5 rounded-full bg-rose-500/80" />
                <span className="size-2.5 rounded-full bg-amber-500/80" />
                <span className="size-2.5 rounded-full bg-emerald-500/80" />
              </div>
              <Terminal className="ml-2 size-3.5 text-zinc-400" />
              <span className="font-semibold text-zinc-300">Engine Telemetry Stream</span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-micro text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                onClick={handleCopyLogs}
              >
                {copiedLog ? (
                  <>
                    <Check className="size-3 text-emerald-400" />
                    <span>Đã chép</span>
                  </>
                ) : (
                  <>
                    <Copy className="size-3" />
                    <span>Sao chép log</span>
                  </>
                )}
              </Button>
              <button
                type="button"
                onClick={() => setShowConsole((v) => !v)}
                className="text-zinc-400 hover:text-zinc-200"
                title={showConsole ? "Thu gọn console" : "Mở rộng console"}
              >
                <ChevronDown
                  className={cn("size-4 transition-transform", !showConsole && "-rotate-90")}
                />
              </button>
            </div>
          </div>

          {showConsole && (
            <div className="max-h-48 min-h-24 overflow-y-auto p-3.5 space-y-1.5">
              {consoleLogs.map((log) => (
                <div key={log.id} className="leading-relaxed">
                  <span className="text-zinc-500">[{log.time}]</span>{" "}
                  <span
                    className={cn(
                      log.text.includes("Hoàn tất") || log.text.includes("Hoàn thành")
                        ? "text-emerald-400 font-semibold"
                        : log.text.includes("Lỗi")
                          ? "text-rose-400 font-bold"
                          : log.text.includes("Bắt đầu")
                            ? "text-sky-300"
                            : "text-zinc-300",
                    )}
                  >
                    {log.text}
                  </span>
                </div>
              ))}
              <div className="flex items-center gap-1 text-primary pt-1">
                <span>&gt; Đang phân tích...</span>
                <span className="inline-block size-2 bg-primary animate-pulse" />
              </div>
              <div ref={terminalEndRef} />
            </div>
          )}
        </div>

        {/* Pro-Tips Rotating Box */}
        <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-meta text-foreground transition-all duration-300">
          <Lightbulb className="size-4 shrink-0 text-amber-500 animate-bounce" />
          <p className="flex-1 text-body leading-relaxed">{PRO_TIPS[tipIndex]}</p>
        </div>

        {/* Details: Why Slow? */}
        <details className="text-meta text-muted-foreground">
          <summary className="cursor-pointer font-medium hover:text-foreground">
            {t("run.whySlowTitle")}
          </summary>
          <div className="mt-2 space-y-1 rounded-lg border border-border/50 bg-muted/20 p-3">
            <p>
              {t("run.whySlowSummary", {
                calls: totals.calls,
                duration: formatDuration(totals.totalMs),
              })}
            </p>
            {totals.slowestStage !== null && (
              <p>
                {t("run.whySlowSlowest", {
                  duration: formatDuration(totals.slowestMs),
                  stage: t(STAGE_LABEL_KEYS[totals.slowestStage]),
                })}
              </p>
            )}
            {STAGE_ORDER.map((stage) => (
              <p key={stage}>
                <span className="font-semibold text-foreground">{t(STAGE_LABEL_KEYS[stage])}</span>{" "}
                — {t(STAGE_HINT_KEYS[stage])}
              </p>
            ))}
            <p className="pt-1 text-micro">{t("run.noPauseNote")}</p>
          </div>
        </details>

        {streamError && (
          <p className="text-meta text-warning font-medium">{t("run.streamReconnecting")}</p>
        )}
      </CardContent>
    </Card>
  );
}

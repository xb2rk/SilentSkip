import type { Verdict } from "@silentskip/contracts";
import { cn } from "cn";
import { Ban, CheckCircle2, Info, Sparkles, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDuration } from "@/lib/format";

const VERDICT_CONFIG: Record<
  Verdict,
  {
    icon: typeof CheckCircle2;
    borderClass: string;
    badgeClass: string;
  }
> = {
  pass: {
    icon: CheckCircle2,
    borderClass: "border-l-4 border-l-emerald-500",
    badgeClass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  },
  pass_with_warnings: {
    icon: Info,
    borderClass: "border-l-4 border-l-blue-500",
    badgeClass: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  },
  needs_review: {
    icon: TriangleAlert,
    borderClass: "border-l-4 border-l-amber-500",
    badgeClass: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  },
  fail: {
    icon: Ban,
    borderClass: "border-l-4 border-l-rose-500",
    badgeClass: "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30",
  },
  insufficient_evidence: {
    icon: Info,
    borderClass: "border-l-4 border-l-muted-foreground",
    badgeClass: "bg-muted text-muted-foreground border-border",
  },
};

const VERDICT_LABEL_KEYS: Record<Verdict, string> = {
  pass: "run.verdictPass",
  pass_with_warnings: "run.verdictPassWithWarnings",
  needs_review: "run.verdictNeedsReview",
  fail: "run.verdictFail",
  insufficient_evidence: "run.verdictInsufficient",
};

export interface HeroVerdictBannerProps {
  readonly verdict: Verdict;
  readonly qualityScore: number;
  readonly verification: {
    readonly anchorsChecked: number;
    readonly anchorsStripped: number;
    readonly percent: number | null;
    readonly issues: number;
  };
  readonly criticalCount: number;
  readonly majorCount: number;
  readonly minorCount: number;
  readonly infoCount: number;
  readonly durationMs: number | null;
  readonly onAskCopilot: () => void;
}

export function HeroVerdictBanner({
  verdict,
  qualityScore,
  verification,
  criticalCount,
  majorCount,
  minorCount,
  infoCount,
  durationMs,
  onAskCopilot,
}: HeroVerdictBannerProps) {
  const { t } = useTranslation();
  const verdictCfg = VERDICT_CONFIG[verdict];
  const VerdictIcon = verdictCfg.icon;

  return (
    <Card className={cn("surface relative overflow-hidden", verdictCfg.borderClass)}>
      <CardContent className="space-y-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3.5">
            <span
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-lg border px-3 text-body font-bold tracking-tight shadow-xs",
                verdictCfg.badgeClass,
              )}
            >
              <VerdictIcon className="size-4" />
              {t(VERDICT_LABEL_KEYS[verdict])}
            </span>

            <div className="flex items-baseline gap-1.5 pl-1">
              <span className="text-2xl font-black tracking-tight tabular-nums text-foreground">
                {qualityScore}
              </span>
              <span className="text-meta text-muted-foreground">/ 100</span>
            </div>

            <Badge variant="outline" className="text-micro font-medium text-muted-foreground">
              {verification.percent === null
                ? t("run.verifiedNone")
                : t("run.verifiedAnchors", { percent: verification.percent })}
            </Badge>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2 border-primary/30 text-primary hover:bg-primary/10"
            onClick={onAskCopilot}
          >
            <Sparkles className="size-3.5" />
            <span>Hỏi Copilot về kết quả</span>
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div
            className={cn(
              "rounded-lg border p-3 transition-colors",
              criticalCount > 0
                ? "border-rose-500/30 bg-rose-500/5 text-rose-600 dark:text-rose-400"
                : "border-border/60 bg-muted/20 text-muted-foreground",
            )}
          >
            <div className="text-micro font-medium uppercase tracking-wider">
              Nghiêm trọng (Critical)
            </div>
            <div className="mt-1 text-2xl font-black tabular-nums">{criticalCount}</div>
          </div>

          <div
            className={cn(
              "rounded-lg border p-3 transition-colors",
              majorCount > 0
                ? "border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400"
                : "border-border/60 bg-muted/20 text-muted-foreground",
            )}
          >
            <div className="text-micro font-medium uppercase tracking-wider">Cảnh báo (Major)</div>
            <div className="mt-1 text-2xl font-black tabular-nums">{majorCount}</div>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-muted-foreground">
            <div className="text-micro font-medium uppercase tracking-wider">Nhẹ / Info</div>
            <div className="mt-1 text-2xl font-black tabular-nums text-foreground">
              {minorCount + infoCount}
            </div>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-muted-foreground">
            <div className="text-micro font-medium uppercase tracking-wider">Thời gian AI</div>
            <div className="mt-1 text-2xl font-black tabular-nums text-foreground">
              {formatDuration(durationMs ?? 0)}
            </div>
          </div>
        </div>

        {verification.percent !== null && (
          <div className="text-meta text-muted-foreground">
            {t("run.verifiedDetail", {
              checked: verification.anchorsChecked,
              stripped: verification.anchorsStripped,
              issues: verification.issues,
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

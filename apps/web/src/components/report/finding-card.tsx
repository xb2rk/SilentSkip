import type { Anchor, SynthesizeOutput } from "@silentskip/contracts";
import { cn } from "cn";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

type ReportFinding = SynthesizeOutput["findings"][number];

const SEVERITY_STYLES: Record<ReportFinding["severity"], string> = {
  critical: "bg-danger/15 text-danger font-semibold",
  major: "bg-warning/15 text-warning font-semibold",
  minor: "bg-info/15 text-info font-semibold",
  info: "bg-neutral/15 text-neutral font-semibold",
};

const SEVERITY_CLASSES: Record<ReportFinding["severity"], string> = {
  critical: "finding-critical",
  major: "finding-major",
  minor: "finding-minor",
  info: "finding-info",
};

const SEVERITY_LABEL_KEYS: Record<ReportFinding["severity"], string> = {
  critical: "run.severityCritical",
  major: "run.severityMajor",
  minor: "run.severityMinor",
  info: "run.severityInfo",
};

const CONFIDENCE_LABEL_KEYS: Record<ReportFinding["confidence"], string> = {
  exact: "run.confidenceExact",
  inferred: "run.confidenceInferred",
  unknown: "run.confidenceUnknown",
};

interface AnchorChipProps {
  readonly anchorId: string;
  readonly anchorsById: ReadonlyMap<string, Anchor>;
  readonly onAnchorClick: (anchor: Anchor) => void;
  /** Compact mode drops the file path — use inside cards where the file is already on screen. */
  readonly compact?: boolean;
}

/** One citation chip — label is the human-readable `file:line`, the id stays the raw truth. */
export function AnchorChip({ anchorId, anchorsById, onAnchorClick, compact }: AnchorChipProps) {
  const { t } = useTranslation();
  const anchor = anchorsById.get(anchorId);
  const label =
    anchor === undefined
      ? t("run.anchorMissing")
      : compact === true
        ? `:${anchor.lineStart}${anchor.lineEnd === anchor.lineStart ? "" : `-${anchor.lineEnd}`}`
        : `${anchor.file}:${anchor.lineStart}${anchor.lineEnd === anchor.lineStart ? "" : `-${anchor.lineEnd}`}`;
  return (
    <button
      type="button"
      title={anchorId}
      disabled={anchor === undefined}
      onClick={() => {
        if (anchor !== undefined) onAnchorClick(anchor);
      }}
      className={cn(
        "chip max-w-72 truncate py-0.5 font-mono transition-colors",
        anchor === undefined ? "opacity-60" : "hover:bg-accent/60",
      )}
    >
      <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** Who last changed the file behind a finding (E9.3) - git facts, never inferred intent. */
export interface ChangeAttribution {
  readonly author: string;
  readonly short: string;
  readonly date: string;
  readonly subject: string;
  readonly changedInWorktree: boolean;
}

/** One muted "Ai đổi?" line shown inside an expanded card. */
export function AttributionLine({ attribution }: { readonly attribution: ChangeAttribution }) {
  const { t } = useTranslation();
  return (
    <p
      className="mt-1.5 text-meta text-muted-foreground"
      title={attribution.subject === "" ? undefined : attribution.subject}
    >
      <span className="font-medium text-foreground/80">{t("run.attributionLabel")}: </span>
      {attribution.author}
      {attribution.short !== "" && <> · {attribution.short}</>}
      {attribution.changedInWorktree && <> · {t("run.attributionUncommitted")}</>}
    </p>
  );
}

interface FindingCardProps {
  readonly finding: ReportFinding;
  readonly anchorsById: ReadonlyMap<string, Anchor>;
  readonly onAnchorClick: (anchor: Anchor) => void;
  readonly defaultOpen?: boolean;
  readonly onAsk?: (title: string) => void;
  readonly attribution?: ChangeAttribution | undefined;
}

/**
 * Modern verified finding card with severity accent, prominent title, and 1-click Copilot trigger
 */
export function FindingCard({
  finding,
  anchorsById,
  onAnchorClick,
  defaultOpen = false,
  onAsk,
  attribution,
}: FindingCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className={cn(
        "surface p-4 transition-all hover:shadow-xs",
        SEVERITY_CLASSES[finding.severity],
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex h-6 items-center rounded-md px-2 text-micro uppercase tracking-wider",
            SEVERITY_STYLES[finding.severity],
          )}
        >
          {t(SEVERITY_LABEL_KEYS[finding.severity])}
        </span>
        <span className="inline-flex h-6 items-center rounded-md border border-border/70 px-2 text-micro text-muted-foreground">
          {t(CONFIDENCE_LABEL_KEYS[finding.confidence])}
        </span>
        {finding.confidence === "unknown" && (
          <span className="inline-flex h-6 items-center rounded-md bg-warning/15 px-2 text-micro font-medium text-warning dark:text-warning">
            {t("run.needsVerification")}
          </span>
        )}

        <h3 className="min-w-0 flex-1 text-body-lg font-bold text-foreground">{finding.title}</h3>

        {onAsk !== undefined && (
          <Button
            variant="outline"
            size="xs"
            className="h-6 gap-1 text-micro font-semibold border-primary/30 text-primary hover:bg-primary/10"
            onClick={(e) => {
              e.stopPropagation();
              onAsk(finding.title);
            }}
          >
            <Sparkles className="size-3 text-primary" />
            <span>Hỏi Copilot</span>
          </Button>
        )}

        <button
          type="button"
          aria-expanded={open}
          aria-label={t("run.detailsToggle")}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      <p
        className={cn("mt-2 text-body leading-relaxed text-foreground/90", !open && "line-clamp-2")}
      >
        {finding.statement}
      </p>

      {open && (
        <div className="pt-2 border-t border-border/40 mt-3 space-y-2">
          {attribution !== undefined && <AttributionLine attribution={attribution} />}
          {finding.consequence !== undefined && finding.consequence !== "" && (
            <div className="rounded-lg bg-muted/40 p-2.5 text-meta leading-relaxed">
              <span className="font-semibold text-foreground">{t("run.consequenceLabel")}: </span>
              <span className="text-muted-foreground">{finding.consequence}</span>
            </div>
          )}
          {finding.recommendation !== undefined && finding.recommendation !== "" && (
            <div className="rounded-lg bg-primary/[0.04] border border-primary/20 p-2.5 text-meta leading-relaxed">
              <span className="font-semibold text-primary">{t("run.recommendationLabel")}: </span>
              <span className="text-foreground/90">{finding.recommendation}</span>
            </div>
          )}
          {finding.anchors.length > 0 && (
            <div className="pt-1">
              <p className="text-micro font-medium text-muted-foreground mb-1.5">
                Dòng code liên quan:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {finding.anchors.map((anchorId) => (
                  <AnchorChip
                    key={anchorId}
                    anchorId={anchorId}
                    anchorsById={anchorsById}
                    onAnchorClick={onAnchorClick}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import type { Anchor, SynthesizeOutput } from "@craftland-qa/contracts";
import { cn } from "cn";
import { ChevronDown, ChevronRight, MessageCircleQuestion } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

type ReportFinding = SynthesizeOutput["findings"][number];

const SEVERITY_STYLES: Record<ReportFinding["severity"], string> = {
  critical: "bg-danger/15 text-danger dark:text-danger",
  major: "bg-warning/15 text-warning dark:text-warning",
  minor: "bg-info/15 text-info dark:text-info",
  info: "bg-neutral/15 text-neutral dark:text-neutral",
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

interface FindingCardProps {
  readonly finding: ReportFinding;
  readonly anchorsById: ReadonlyMap<string, Anchor>;
  readonly onAnchorClick: (anchor: Anchor) => void;
  readonly defaultOpen?: boolean;
  readonly onAsk?: (title: string) => void;
}

/**
 * One verified finding: severity + confidence, the claim, and its citation chips.
 * Collapsed by default — the header plus the first lines of the claim stay readable,
 * consequence/recommendation/anchors open on demand.
 */
export function FindingCard({
  finding,
  anchorsById,
  onAnchorClick,
  defaultOpen = false,
  onAsk,
}: FindingCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex h-6 items-center rounded-md px-2 text-micro font-medium",
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
        <h3 className="min-w-0 flex-1 text-body font-semibold">{finding.title}</h3>
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
      <p className={cn("mt-2 text-body leading-relaxed", !open && "line-clamp-2")}>
        {finding.statement}
      </p>
      {open && (
        <>
          {finding.consequence !== undefined && finding.consequence !== "" && (
            <p className="mt-2 text-meta leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground/80">{t("run.consequenceLabel")}: </span>
              {finding.consequence}
            </p>
          )}
          {finding.recommendation !== undefined && finding.recommendation !== "" && (
            <p className="mt-1.5 text-meta leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground/80">
                {t("run.recommendationLabel")}:{" "}
              </span>
              {finding.recommendation}
            </p>
          )}
          {finding.anchors.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {finding.anchors.map((anchorId) => (
                <AnchorChip
                  key={anchorId}
                  anchorId={anchorId}
                  anchorsById={anchorsById}
                  onAnchorClick={onAnchorClick}
                />
              ))}
            </div>
          )}
          {onAsk !== undefined && (
            <div className="mt-3 flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => onAsk(finding.title)}>
                <MessageCircleQuestion className="size-3.5" />
                {t("run.askAboutThis")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

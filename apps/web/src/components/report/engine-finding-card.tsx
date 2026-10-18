import type { Anchor, DigestFinding } from "@craftland-qa/contracts";
import { cn } from "cn";
import { ChevronDown, ChevronRight, MessageCircleQuestion } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AnchorChip } from "./finding-card";

/**
 * One engine finding (the FACT layer): deterministic, budget-immune, every claim traceable.
 * Collapsed by default — rule id, severity and title stay visible; the message, witness
 * anchors and derivation chain open on demand. Rendering only — nothing here can change a finding.
 */

const SEVERITY_STYLES: Record<DigestFinding["severity"], string> = {
  critical: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  major: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  minor: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  info: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
};

const SEVERITY_LABEL_KEYS: Record<DigestFinding["severity"], string> = {
  critical: "run.severityCritical",
  major: "run.severityMajor",
  minor: "run.severityMinor",
  info: "run.severityInfo",
};

const CONFIDENCE_LABEL_KEYS: Record<DigestFinding["confidence"], string> = {
  exact: "run.confidenceExact",
  inferred: "run.confidenceInferred",
};

export interface EngineFindingCardProps {
  readonly finding: DigestFinding;
  readonly anchorsById: ReadonlyMap<string, Anchor>;
  readonly onAnchorClick: (anchor: Anchor) => void;
  readonly defaultOpen?: boolean;
  readonly onAsk?: (title: string) => void;
}

/** One engine finding card — rule badge, severity/confidence, message, anchors, derivation. */
export function EngineFindingCard({
  finding,
  anchorsById,
  onAnchorClick,
  defaultOpen = false,
  onAsk,
}: EngineFindingCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const [showDerivation, setShowDerivation] = useState(false);
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono text-[11px]">
          {finding.ruleId}
        </Badge>
        <span
          className={cn(
            "inline-flex h-6 items-center rounded-md px-2 text-[11px]",
            SEVERITY_STYLES[finding.severity],
          )}
        >
          {t(SEVERITY_LABEL_KEYS[finding.severity])}
        </span>
        <span
          className={cn(
            "inline-flex h-6 items-center rounded-md border border-border/60 px-2 text-[11px] text-muted-foreground",
            finding.confidence === "inferred" &&
              "border-amber-400/40 text-amber-600 dark:text-amber-400",
          )}
        >
          {t(CONFIDENCE_LABEL_KEYS[finding.confidence])}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {t("run.engineDeterministic")}
        </span>
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
      <h3 className="mt-2 text-[13px] font-semibold leading-snug">{finding.title}</h3>
      <p
        className={cn(
          "mt-1 text-[12.5px] leading-relaxed text-muted-foreground",
          !open && "line-clamp-2",
        )}
      >
        {finding.message}
      </p>
      {open && (
        <>
          {finding.anchors.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
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
          <button
            type="button"
            onClick={() => setShowDerivation((value) => !value)}
            className="mt-2 flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground"
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform", showDerivation && "rotate-90")}
            />
            {t("run.derivationTitle")}
          </button>
          {showDerivation && (
            <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[11.5px] text-muted-foreground">
              {finding.derivation.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
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

import type { Anchor, DigestFinding } from "@silentskip/contracts";
import { cn } from "cn";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AnchorChip, AttributionLine, type ChangeAttribution } from "./finding-card";

/**
 * One engine finding (the FACT layer): deterministic, budget-immune, every claim traceable.
 * Collapsed by default — rule id, severity and title stay visible; the message, witness
 * anchors and derivation chain open on demand. Rendering only — nothing here can change a finding.
 */

const SEVERITY_STYLES: Record<DigestFinding["severity"], string> = {
  critical: "bg-danger/15 text-danger font-semibold",
  major: "bg-warning/15 text-warning font-semibold",
  minor: "bg-info/15 text-info font-semibold",
  info: "bg-neutral/15 text-neutral font-semibold",
};

const SEVERITY_CLASSES: Record<DigestFinding["severity"], string> = {
  critical: "finding-critical",
  major: "finding-major",
  minor: "finding-minor",
  info: "finding-info",
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
  readonly attribution?: ChangeAttribution | undefined;
}

/** One engine finding card — rule badge, severity/confidence, message, anchors, derivation. */
export function EngineFindingCard({
  finding,
  anchorsById,
  onAnchorClick,
  defaultOpen = false,
  onAsk,
  attribution,
}: EngineFindingCardProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const [showDerivation, setShowDerivation] = useState(false);

  return (
    <div
      className={cn(
        "surface p-4 transition-all hover:shadow-xs",
        SEVERITY_CLASSES[finding.severity],
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="font-mono text-micro font-semibold bg-background">
          {finding.ruleId}
        </Badge>
        <span
          className={cn(
            "inline-flex h-6 items-center rounded-md px-2 text-micro uppercase tracking-wider",
            SEVERITY_STYLES[finding.severity],
          )}
        >
          {t(SEVERITY_LABEL_KEYS[finding.severity])}
        </span>
        <span
          className={cn(
            "inline-flex h-6 items-center rounded-md border border-border/60 px-2 text-micro text-muted-foreground",
            finding.confidence === "inferred" && "border-warning/40 text-warning dark:text-warning",
          )}
        >
          {t(CONFIDENCE_LABEL_KEYS[finding.confidence])}
        </span>
        {finding.effectConfidence !== undefined && finding.effectConfidence !== "exact" && (
          <span
            className={cn(
              "inline-flex h-6 items-center rounded-md border border-border/60 px-2 text-micro text-muted-foreground",
              finding.effectConfidence === "inferred" &&
                "border-warning/40 text-warning dark:text-warning",
            )}
          >
            {t(
              finding.effectConfidence === "inferred" ? "run.effectInferred" : "run.effectUnknown",
            )}
          </span>
        )}

        <Badge variant="secondary" className="text-micro font-normal text-muted-foreground">
          {t("run.engineDeterministic")}
        </Badge>

        <div className="ml-auto flex items-center gap-1.5">
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
      </div>

      <h3 className="mt-2 text-body-lg font-bold text-foreground leading-snug">{finding.title}</h3>

      <p
        className={cn(
          "mt-1 text-body leading-relaxed text-muted-foreground",
          !open && "line-clamp-2",
        )}
      >
        {finding.message}
      </p>

      {open && (
        <div className="pt-2 border-t border-border/40 mt-3 space-y-2">
          {attribution !== undefined && <AttributionLine attribution={attribution} />}
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

          <button
            type="button"
            onClick={() => setShowDerivation((value) => !value)}
            className="mt-2 flex items-center gap-1 text-meta text-muted-foreground hover:text-foreground font-medium"
          >
            <ChevronRight
              className={cn("size-3.5 transition-transform", showDerivation && "rotate-90")}
            />
            {t("run.derivationTitle")}
          </button>

          {showDerivation && (
            <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-meta text-muted-foreground bg-muted/30 p-2.5 rounded-lg border border-border/50">
              {finding.derivation.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

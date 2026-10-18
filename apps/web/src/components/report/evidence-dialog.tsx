import type { Anchor } from "@craftland-qa/contracts";
import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ANCHOR_KIND_LABEL_KEYS: Record<Anchor["kind"], string> = {
  csv: "run.anchorKindCsv",
  code: "run.anchorKindCode",
  contract: "run.anchorKindContract",
  diff: "run.anchorKindDiff",
};

interface EvidenceDialogProps {
  /** Anchor to show; `null` keeps the dialog closed. */
  readonly anchor: Anchor | null;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Evidence viewer — the raw span behind one citation, with its exact source lines.
 * Read-only by design: this is the same bytes the engine anchored, nothing re-rendered.
 */
export function EvidenceDialog({ anchor, onOpenChange }: EvidenceDialogProps) {
  const { t } = useTranslation();
  const lines =
    anchor === null
      ? []
      : anchor.snippet
          .split("\n")
          .map((text, offset) => ({ text, lineNumber: anchor.lineStart + offset }));
  const citation =
    anchor === null
      ? ""
      : anchor.lineStart === anchor.lineEnd
        ? `${anchor.file}:${anchor.lineStart}`
        : `${anchor.file}:${anchor.lineStart}-${anchor.lineEnd}`;

  function handleCopy(): void {
    if (citation === "") return;
    navigator.clipboard
      .writeText(citation)
      .then(() => toast.success(t("common.copied")))
      .catch(() => toast.error(t("common.copyFailed")));
  }

  return (
    <Dialog open={anchor !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {anchor !== null && (
          <>
            <DialogHeader>
              <DialogTitle className="break-all font-mono text-body">{anchor.file}</DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="font-normal">
                  {anchor.ref === "A" ? t("run.evidenceRefA") : t("run.evidenceRefB")}
                </Badge>
                <span>
                  {t("run.evidenceLines", { start: anchor.lineStart, end: anchor.lineEnd })}
                </span>
                <span className="text-muted-foreground">·</span>
                <span>{t(ANCHOR_KIND_LABEL_KEYS[anchor.kind])}</span>
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-80 overflow-auto rounded-lg border border-border/60 bg-muted/30">
              <pre className="p-3 font-mono text-meta leading-relaxed">
                {lines.map((line) => (
                  <div key={line.lineNumber} className="flex gap-3">
                    <span className="w-10 shrink-0 select-none text-right text-muted-foreground tabular-nums">
                      {line.lineNumber}
                    </span>
                    <span className="whitespace-pre-wrap break-all">{line.text}</span>
                  </div>
                ))}
              </pre>
            </div>
            <DialogFooter className="justify-between sm:justify-between">
              <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
                <Copy className="size-3.5" />
                {t("run.copyCitation")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                {t("common.cancel")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

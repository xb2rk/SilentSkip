import { Info, Send, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/page-header";
import { PhaseBadge } from "@/components/phase-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const SAMPLES = ["whatIf.sample1", "whatIf.sample2", "whatIf.sample3"] as const;

/**
 * What-If Studio. The composer is typeable today (state is local) but sending stays
 * disabled until E6 wires the session ledger + Insea answer pass.
 */
export function WhatIfPage() {
  const { t } = useTranslation();
  const [question, setQuestion] = useState("");

  return (
    <div className="space-y-6">
      <PageHeader title={t("whatIf.title")} description={t("whatIf.description")} />
      <Alert>
        <Info className="size-4" />
        <AlertDescription>{t("whatIf.banner")}</AlertDescription>
      </Alert>
      <Card>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <Sparkles className="size-5" />
            </div>
            <div className="space-y-1">
              <h2 className="text-sm font-semibold">{t("whatIf.emptyTitle")}</h2>
              <p className="mx-auto max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
                {t("whatIf.emptyDescription")}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
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
          </div>
          <div className="space-y-3 border-t border-border/60 pt-4">
            <Textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={t("whatIf.composerPlaceholder")}
              className="min-h-20"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-muted-foreground">{t("whatIf.composerHint")}</span>
              <div className="flex items-center gap-2">
                <PhaseBadge phase="E6" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button disabled>
                        <Send className="size-4" />
                        {t("whatIf.send")}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t("common.comingSoonPhase", { phase: "E6" })}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

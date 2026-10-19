import type { ReviewPassMeta, ReviewRunResult } from "@silentskip/contracts";
import { cn } from "cn";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatBytes, formatDuration } from "@/lib/format";

export const PASS_LABEL_KEYS: Record<ReviewPassMeta["pass"], string> = {
  map: "run.passMap",
  read: "run.passRead",
  dig: "run.passDig",
  synthesize: "run.passSynthesize",
  whatif: "run.passWhatIf",
};

export const SALVAGE_LABEL_KEYS: Record<ReviewPassMeta["salvage"], string> = {
  clean: "run.salvageClean",
  stripped: "run.salvageStripped",
  fence: "run.salvageFence",
  braces: "run.salvageBraces",
  "text-fallback": "run.salvageTextFallback",
};

export interface PassGroup {
  readonly pass: ReviewPassMeta["pass"];
  readonly salvage: ReviewPassMeta["salvage"];
  readonly cached: boolean;
  readonly calls: number;
  readonly ms: number;
  readonly bytes: number;
}

export function groupPasses(passes: readonly ReviewPassMeta[]): PassGroup[] {
  const groups = new Map<string, PassGroup>();
  for (const meta of passes) {
    const key = `${meta.pass}|${meta.salvage}|${meta.cached ? "cached" : "live"}`;
    const current = groups.get(key);
    if (current === undefined) {
      groups.set(key, {
        pass: meta.pass,
        salvage: meta.salvage,
        cached: meta.cached,
        calls: 1,
        ms: meta.latencyMs,
        bytes: meta.payloadBytes,
      });
    } else {
      groups.set(key, {
        ...current,
        calls: current.calls + 1,
        ms: current.ms + meta.latencyMs,
        bytes: current.bytes + meta.payloadBytes,
      });
    }
  }
  return [...groups.values()];
}

export function RunSummaryCard({ result }: { readonly result: ReviewRunResult }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const groups = groupPasses(result.passes);
  const totalMs = result.passes.reduce((sum, meta) => sum + meta.latencyMs, 0);
  const dropped = result.contextManifest.counts.evidenceDropped;

  return (
    <Card className="surface">
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{t("run.summaryTitle")}</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? t("run.summaryCollapse") : t("run.summaryExpand")}
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
          </Button>
        </div>
        <p className={cn("text-body leading-relaxed", !open && "line-clamp-3")}>
          {result.report.executiveSummary}
        </p>
        {!open && result.report.topConcerns.length > 0 && (
          <p className="text-meta text-muted-foreground">
            {t("run.summaryMoreConcerns", { count: result.report.topConcerns.length })}
          </p>
        )}
        {open && (
          <div className="space-y-4">
            {result.report.topConcerns.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-body font-semibold">{t("run.notesConcernsTitle")}</h3>
                <ol className="list-decimal space-y-1 pl-5 text-body leading-relaxed">
                  {result.report.topConcerns.map((concern) => (
                    <li key={concern}>{concern}</li>
                  ))}
                </ol>
              </section>
            )}
            {result.report.recommendedTests.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-body font-semibold">{t("run.notesTestsTitle")}</h3>
                <ul className="list-disc space-y-1 pl-5 text-body leading-relaxed">
                  {result.report.recommendedTests.map((test) => (
                    <li key={test}>{test}</li>
                  ))}
                </ul>
              </section>
            )}
            {result.report.unknowns.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-body font-semibold">{t("run.notesUnknownsTitle")}</h3>
                <ul className="list-disc space-y-1 pl-5 text-body leading-relaxed text-muted-foreground">
                  {result.report.unknowns.map((unknown) => (
                    <li key={unknown}>{unknown}</li>
                  ))}
                </ul>
              </section>
            )}
            {result.passes.length > 0 && (
              <section className="space-y-1.5">
                <h3 className="text-body font-semibold">{t("run.summaryProcessTitle")}</h3>
                <p className="text-meta text-muted-foreground">
                  {t("run.summaryProcessTotal", {
                    count: result.passes.length,
                    duration: formatDuration(totalMs),
                  })}
                </p>
                {dropped > 0 && (
                  <p className="text-meta text-warning">
                    {t("run.summaryEvidenceDropped", { count: dropped })}
                  </p>
                )}
                <ul className="space-y-1 font-mono text-meta text-muted-foreground">
                  {groups.map((group) => {
                    const passName = t(PASS_LABEL_KEYS[group.pass]);
                    const salvageName = t(SALVAGE_LABEL_KEYS[group.salvage]);
                    return (
                      <li
                        key={`${group.pass}|${group.salvage}|${group.cached ? "c" : "l"}`}
                        className="tabular-nums"
                      >
                        {group.cached
                          ? t("run.summaryPassRowCached", {
                              pass: passName,
                              salvage: salvageName,
                              count: group.calls,
                              duration: formatDuration(group.ms),
                            })
                          : t("run.summaryPassRow", {
                              pass: passName,
                              salvage: salvageName,
                              count: group.calls,
                              duration: formatDuration(group.ms),
                              size: formatBytes(group.bytes),
                            })}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

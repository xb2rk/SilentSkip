import type {
  Anchor,
  DigestBundle,
  DigestFinding,
  RunTheme,
  SynthesizeOutput,
} from "@craftland-qa/contracts";
import { cn } from "cn";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { AnchorChip } from "./finding-card";

/** Status letter + colour for one file chip — raw engine skeleton status, nothing inferred. */
const STATUS_STYLES: Record<
  "added" | "removed" | "changed",
  { letter: string; className: string }
> = {
  added: { letter: "+", className: "text-emerald-600 dark:text-emerald-400" },
  removed: { letter: "−", className: "text-rose-600 dark:text-rose-400" },
  changed: { letter: "~", className: "text-amber-600 dark:text-amber-400" },
};

const MAX_VISIBLE_FILES = 12;

interface ThemeMapProps {
  /** The run's engine-validated partition (persisted with the run, E7.4). */
  readonly themes: readonly RunTheme[];
  /** One structured narrative per theme id — AI INTERPRETATION, validated by the linker (E7.5). */
  readonly narratives: SynthesizeOutput["themes"];
  readonly digest: DigestBundle;
  readonly engineFindings: readonly DigestFinding[];
  readonly aiFindings: SynthesizeOutput["findings"];
  readonly anchorsById: ReadonlyMap<string, Anchor>;
  readonly onAnchorClick: (anchor: Anchor) => void;
}

/**
 * The change map (E7.4, structured narratives at E7.5) — every engine-validated theme with its
 * summary / behaviour change / watch-for narrative, file set and finding counts. The partition,
 * counts and file statuses come from the engine; the narrative text is labelled AI interpretation
 * and its anchors were linker-validated against the full registry.
 */
export function ThemeMap({
  themes,
  narratives,
  digest,
  engineFindings,
  aiFindings,
  anchorsById,
  onAnchorClick,
}: ThemeMapProps) {
  const { t } = useTranslation();
  if (themes.length === 0) {
    return <p className="text-[12.5px] text-muted-foreground">{t("run.themeMapEmpty")}</p>;
  }

  const narrativeOf = new Map(
    narratives.map((narrative) => [narrative.themeId, narrative] as const),
  );
  const themeOfFile = new Map(
    themes.flatMap((theme) => theme.files.map((file) => [file, theme.id] as const)),
  );
  const fileStatus = new Map(
    digest.plan.skeleton.files.map((file) => [file.path, file.status] as const),
  );
  const anchorFile = new Map(digest.anchors.map((anchor) => [anchor.id, anchor.file] as const));
  const countFor = (findings: readonly { readonly anchors: string[] }[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const finding of findings) {
      const first = finding.anchors[0];
      if (first === undefined) continue;
      const themeId = themeOfFile.get(anchorFile.get(first) ?? "");
      if (themeId === undefined) continue;
      counts.set(themeId, (counts.get(themeId) ?? 0) + 1);
    }
    return counts;
  };
  const engineCount = countFor(engineFindings);
  const aiCount = countFor(aiFindings);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <h3 className="text-[13px] font-semibold">{t("run.themeMapTitle")}</h3>
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          {t("run.themeMapHint")}
        </p>
      </div>
      {themes.map((theme) => {
        const narrative = narrativeOf.get(theme.id);
        const shown = theme.files.slice(0, MAX_VISIBLE_FILES);
        const extra = theme.files.length - shown.length;
        const themeEngine = engineCount.get(theme.id) ?? 0;
        const themeAi = aiCount.get(theme.id) ?? 0;
        return (
          <div key={theme.id} className="space-y-2.5 rounded-xl border border-border/60 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-[13px] font-semibold">{theme.name}</h4>
              <Badge variant="secondary" className="font-normal">
                {t("run.themeFiles", { count: theme.files.length })}
              </Badge>
              {themeEngine + themeAi > 0 && (
                <span className="text-[11.5px] text-muted-foreground">
                  {t("run.themeCounts", { engine: themeEngine, ai: themeAi })}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <Badge variant="secondary" className="mt-0.5 shrink-0 font-normal">
                {t("run.interpretationBadge")}
              </Badge>
              {narrative === undefined ? (
                <p className="text-[12px] text-muted-foreground">{t("run.themeNoNarrative")}</p>
              ) : (
                <div className="flex-1 space-y-1.5">
                  <p className="text-[12.5px] leading-relaxed">{narrative.summary}</p>
                  <p className="text-[12px] leading-relaxed">
                    <span className="font-medium text-muted-foreground">
                      {t("run.themeBehaviorLabel")}
                    </span>{" "}
                    {narrative.behaviorChange}
                  </p>
                  <p className="text-[12px] leading-relaxed">
                    <span className="font-medium text-muted-foreground">
                      {t("run.themeWatchLabel")}
                    </span>{" "}
                    {narrative.watchFor}
                  </p>
                  {narrative.anchorIds.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">
                        {t("run.themeEvidenceLabel")}
                      </span>
                      {narrative.anchorIds.map((anchorId) => (
                        <AnchorChip
                          key={anchorId}
                          anchorId={anchorId}
                          anchorsById={anchorsById}
                          onAnchorClick={onAnchorClick}
                          compact
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {shown.map((file) => {
                const status = fileStatus.get(file) ?? "changed";
                const style = STATUS_STYLES[status];
                return (
                  <span
                    key={file}
                    title={file}
                    className="inline-flex max-w-80 items-center gap-1 truncate rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 font-mono text-[10.5px]"
                  >
                    <span className={cn("font-semibold", style.className)}>{style.letter}</span>
                    <span className="truncate">{file}</span>
                  </span>
                );
              })}
              {extra > 0 && (
                <span className="inline-flex items-center rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
                  +{extra}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

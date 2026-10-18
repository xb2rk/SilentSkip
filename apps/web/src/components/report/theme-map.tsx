import type {
  Anchor,
  DigestBundle,
  DigestFinding,
  RunTheme,
  SynthesizeOutput,
} from "@craftland-qa/contracts";
import { cn } from "cn";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { AnchorChip } from "./finding-card";

/** Status letter + colour for one file chip — raw engine skeleton status, nothing inferred. */
const STATUS_STYLES: Record<
  "added" | "removed" | "changed",
  { letter: string; className: string }
> = {
  added: { letter: "+", className: "text-positive dark:text-positive" },
  removed: { letter: "−", className: "text-danger dark:text-danger" },
  changed: { letter: "~", className: "text-warning dark:text-warning" },
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
  /** Jump to the findings tabs filtered by this theme. */
  readonly onShowFindings: (themeId: string) => void;
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
  onShowFindings,
}: ThemeMapProps) {
  const { t } = useTranslation();
  const [expandedThemes, setExpandedThemes] = useState<ReadonlySet<string>>(new Set());

  function toggleThemeFiles(themeId: string): void {
    setExpandedThemes((previous) => {
      const next = new Set(previous);
      if (next.has(themeId)) next.delete(themeId);
      else next.add(themeId);
      return next;
    });
  }

  if (themes.length === 0) {
    return <p className="text-body text-muted-foreground">{t("run.themeMapEmpty")}</p>;
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
        <h3 className="text-body font-semibold">{t("run.themeMapTitle")}</h3>
        <p className="text-meta leading-relaxed text-muted-foreground">{t("run.themeMapHint")}</p>
      </div>
      {themes.map((theme) => {
        const narrative = narrativeOf.get(theme.id);
        const isExpanded = expandedThemes.has(theme.id);
        const shown = isExpanded ? theme.files : theme.files.slice(0, MAX_VISIBLE_FILES);
        const extra = theme.files.length - MAX_VISIBLE_FILES;
        const themeEngine = engineCount.get(theme.id) ?? 0;
        const themeAi = aiCount.get(theme.id) ?? 0;
        return (
          <div key={theme.id} className="surface space-y-2.5 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-body font-semibold">{theme.name}</h4>
              <Badge variant="secondary" className="font-normal">
                {t("run.themeFiles", { count: theme.files.length })}
              </Badge>
              {themeEngine + themeAi > 0 && (
                <button
                  type="button"
                  onClick={() => onShowFindings(theme.id)}
                  className="text-meta text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {t("run.themeCounts", { engine: themeEngine, ai: themeAi })} ·{" "}
                  {t("run.themeViewFindings")}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <Badge variant="secondary" className="mt-0.5 shrink-0 font-normal">
                {t("run.interpretationBadge")}
              </Badge>
              {narrative === undefined ? (
                <p className="text-meta text-muted-foreground">{t("run.themeNoNarrative")}</p>
              ) : (
                <div className="flex-1 space-y-1.5">
                  <p className="text-body leading-relaxed">{narrative.summary}</p>
                  <p className="text-meta leading-relaxed">
                    <span className="font-medium text-muted-foreground">
                      {t("run.themeBehaviorLabel")}
                    </span>{" "}
                    {narrative.behaviorChange}
                  </p>
                  <p className="text-meta leading-relaxed">
                    <span className="font-medium text-muted-foreground">
                      {t("run.themeWatchLabel")}
                    </span>{" "}
                    {narrative.watchFor}
                  </p>
                  {narrative.anchorIds.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-micro text-muted-foreground">
                        {t("run.themeEvidenceLabel")}
                      </span>
                      {narrative.anchorIds.map((anchorId) => (
                        <AnchorChip
                          key={anchorId}
                          anchorId={anchorId}
                          anchorsById={anchorsById}
                          onAnchorClick={onAnchorClick}
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
                    className="inline-flex max-w-80 items-center gap-1 truncate rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 font-mono text-micro"
                  >
                    <span className={cn("font-semibold", style.className)}>{style.letter}</span>
                    <span className="truncate">{file}</span>
                  </span>
                );
              })}
              {extra > 0 && (
                <button
                  type="button"
                  onClick={() => toggleThemeFiles(theme.id)}
                  className="inline-flex min-h-6 items-center rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-micro text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                >
                  {isExpanded
                    ? t("run.themeHideFiles")
                    : `+${extra} · ${t("run.themeShowAllFiles")}`}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

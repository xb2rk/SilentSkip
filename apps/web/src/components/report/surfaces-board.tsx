import type {
  Anchor,
  SilentSkipEffect,
  SilentSkipEntry,
  SilentSkipMechanism,
  SilentSkipSurface,
} from "@silentskip/contracts";
import { cn } from "cn";
import { useTranslation } from "react-i18next";
import { AnchorChip } from "@/components/report/finding-card";
import { Badge } from "@/components/ui/badge";

/** Vietnamese labels for the runtime mechanisms (spec §4.8) — identifiers stay English. */
const MECHANISM_LABEL_KEYS: Record<SilentSkipMechanism, string> = {
  length_guard: "run.surfaceMechanismLengthGuard",
  fixed_skip: "run.surfaceMechanismFixedSkip",
  nil_read: "run.surfaceMechanismNilRead",
  parse_fail: "run.surfaceMechanismParseFail",
  missing_binding: "run.surfaceMechanismMissingBinding",
  enum_fallback: "run.surfaceMechanismEnumFallback",
  ref_broken: "run.surfaceMechanismRefBroken",
  duplicate_key: "run.surfaceMechanismDuplicateKey",
};

/** Vietnamese labels for the runtime effect of an entry. */
const EFFECT_LABEL_KEYS: Record<SilentSkipEffect, string> = {
  skipped: "run.surfaceEffectSkipped",
  expected_skip: "run.surfaceEffectExpectedSkip",
  defaulted: "run.surfaceEffectDefaulted",
  disabled: "run.surfaceEffectDisabled",
  fallback: "run.surfaceEffectFallback",
  last_wins: "run.surfaceEffectLastWins",
};

interface SurfacesBoardProps {
  readonly surface: SilentSkipSurface;
  readonly anchorsById: ReadonlyMap<string, Anchor>;
  readonly onAnchorClick: (anchor: Anchor) => void;
}

interface GroupProps {
  readonly title: string;
  readonly entries: readonly SilentSkipEntry[];
  readonly tone: string;
  readonly defaultOpen: boolean;
  readonly anchorsById: ReadonlyMap<string, Anchor>;
  readonly onAnchorClick: (anchor: Anchor) => void;
}

/** One diff bucket (new / fixed / unchanged), collapsed after the diff-touched ones. */
const ROW_KEY_SEPARATOR = "\u001f";

/** Composite keys arrive as `a\u001fb`; render them with a visible separator. */
function displayRowKey(value: string): string {
  return value.split(ROW_KEY_SEPARATOR).join(" | ");
}

function SurfaceGroup({
  title,
  entries,
  tone,
  defaultOpen,
  anchorsById,
  onAnchorClick,
}: GroupProps) {
  const { t } = useTranslation();
  if (entries.length === 0) return null;
  return (
    <details className="surface p-4" open={defaultOpen}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-body font-medium">
        <span className={cn("inline-flex h-6 items-center rounded-md px-2 text-meta", tone)}>
          {title}
        </span>
        <span className="text-meta text-muted-foreground">{entries.length}</span>
      </summary>
      <ul className="mt-3 space-y-3">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="space-y-1.5 border-t border-border/60 pt-3 first:border-0 first:pt-0"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="font-normal">
                {t(MECHANISM_LABEL_KEYS[entry.mechanism])}
              </Badge>
              <span className="text-meta text-muted-foreground">
                {t(EFFECT_LABEL_KEYS[entry.effect])}
              </span>
              <span className="font-mono text-micro text-foreground/80">
                {entry.table}
                {entry.rowKey === "" ? "" : ` · ${displayRowKey(entry.rowKey)}`}
                {entry.column === null ? "" : ` · ${entry.column}`}
              </span>
              <Badge variant="secondary" className="font-normal text-micro">
                {t(entry.confidence === "exact" ? "run.confidenceExact" : "run.confidenceInferred")}
              </Badge>
            </div>
            <p className="text-meta leading-relaxed text-muted-foreground">{entry.detail}</p>
            <div className="flex flex-wrap gap-1.5">
              {entry.anchors.map((anchorId) => (
                <AnchorChip
                  key={anchorId}
                  anchorId={anchorId}
                  anchorsById={anchorsById}
                  onAnchorClick={onAnchorClick}
                />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** A/B silent-skip board: diff-touched buckets open, unchanged collapsed. */
export function SurfacesBoard({ surface, anchorsById, onAnchorClick }: SurfacesBoardProps) {
  const { t } = useTranslation();
  const total = surface.base.entries.length + surface.current.entries.length;
  const changed = surface.delta.newSilent.length + surface.delta.fixed.length;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-body font-semibold">{t("run.surfacesTitle")}</h3>
        <Badge variant="secondary" className="font-normal text-micro">
          {t("run.surfacesNew")}: {surface.delta.newSilent.length}
        </Badge>
        <Badge variant="secondary" className="font-normal text-micro">
          {t("run.surfacesFixed")}: {surface.delta.fixed.length}
        </Badge>
        <Badge variant="secondary" className="font-normal text-micro">
          {t("run.surfacesUnchanged")}: {surface.delta.unchanged.length}
        </Badge>
      </div>
      <p className="text-meta leading-relaxed text-muted-foreground">{surface.note}</p>
      {total === 0 ? (
        <p className="surface p-4 text-meta text-muted-foreground">{t("run.surfacesEmpty")}</p>
      ) : (
        <div className="space-y-3">
          <SurfaceGroup
            title={t("run.surfacesNew")}
            entries={surface.delta.newSilent}
            tone="bg-warning/15 text-warning"
            defaultOpen
            anchorsById={anchorsById}
            onAnchorClick={onAnchorClick}
          />
          <SurfaceGroup
            title={t("run.surfacesFixed")}
            entries={surface.delta.fixed}
            tone="bg-positive/15 text-positive"
            defaultOpen={changed <= 20}
            anchorsById={anchorsById}
            onAnchorClick={onAnchorClick}
          />
          <SurfaceGroup
            title={t("run.surfacesUnchanged")}
            entries={surface.delta.unchanged}
            tone="bg-muted text-muted-foreground"
            defaultOpen={false}
            anchorsById={anchorsById}
            onAnchorClick={onAnchorClick}
          />
        </div>
      )}
    </section>
  );
}

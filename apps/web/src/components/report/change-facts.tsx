import type {
  Anchor,
  DigestBundle,
  DigestScriptChange,
  DigestTableChange,
} from "@craftland-qa/contracts";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AnchorChip } from "@/components/report/finding-card";
import { Badge } from "@/components/ui/badge";

const STATUS_LABEL_KEYS: Record<"added" | "removed" | "changed", string> = {
  added: "compare.statusAdded",
  removed: "compare.statusDeleted",
  changed: "compare.statusModified",
};

const STATUS_STYLES: Record<"added" | "removed" | "changed", string> = {
  added: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  removed: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  changed: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};

interface ChipContext {
  readonly anchorsById: ReadonlyMap<string, Anchor>;
  readonly onAnchorClick: (anchor: Anchor) => void;
}

function StatusBadge({ status }: { readonly status: "added" | "removed" | "changed" }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[10.5px] font-medium ${STATUS_STYLES[status]}`}
    >
      {t(STATUS_LABEL_KEYS[status])}
    </span>
  );
}

interface EntryLineProps extends ChipContext {
  readonly label: string;
  readonly entries: ReadonlyArray<{ readonly name: string; readonly anchorIds: readonly string[] }>;
}

function EntryLine({ label, entries, anchorsById, onAnchorClick }: EntryLineProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {entries.map((entry) => (
        <span
          key={`${entry.name}:${entry.anchorIds.join(",")}`}
          className="inline-flex flex-wrap items-center gap-1"
        >
          <span className="font-mono text-[11.5px]">{entry.name}</span>
          {entry.anchorIds.map((anchorId) => (
            <AnchorChip
              key={anchorId}
              anchorId={anchorId}
              anchorsById={anchorsById}
              onAnchorClick={onAnchorClick}
            />
          ))}
        </span>
      ))}
    </div>
  );
}

function ScriptChangeCard({
  change,
  ...context
}: { readonly change: DigestScriptChange } & ChipContext) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-border/50 p-3">
      <div className="flex items-center gap-2">
        <StatusBadge status={change.status} />
        <span className="truncate font-mono text-[11.5px]" title={change.path}>
          {change.path}
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        {change.symbolsAdded.length > 0 && (
          <EntryLine
            label={t("run.scriptAdded")}
            entries={change.symbolsAdded.map((symbol) => ({
              name: symbol.name,
              anchorIds: [symbol.anchorId],
            }))}
            {...context}
          />
        )}
        {change.symbolsRemoved.length > 0 && (
          <EntryLine
            label={t("run.scriptRemoved")}
            entries={change.symbolsRemoved.map((symbol) => ({
              name: symbol.name,
              anchorIds: [symbol.anchorId],
            }))}
            {...context}
          />
        )}
        {change.symbolsChanged.length > 0 && (
          <EntryLine
            label={t("run.scriptChanged")}
            entries={change.symbolsChanged.map((symbol) => ({
              name: symbol.name,
              anchorIds: [symbol.beforeAnchorId, symbol.afterAnchorId],
            }))}
            {...context}
          />
        )}
      </div>
    </div>
  );
}

function TableChangeCard({
  change,
  ...context
}: { readonly change: DigestTableChange } & ChipContext) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-border/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={change.status} />
        <span className="truncate font-mono text-[11.5px]" title={change.path}>
          {change.path}
        </span>
        {change.headerChanged && (
          <Badge variant="outline" className="h-5 px-1.5 text-[10.5px] font-normal">
            {t("run.headerChanged")}
          </Badge>
        )}
      </div>
      <div className="mt-2 space-y-1.5">
        {change.rowsAdded.length > 0 && (
          <EntryLine
            label={t("run.tableRowsAdded")}
            entries={change.rowsAdded.map((row) => ({ name: row.key, anchorIds: [row.anchorId] }))}
            {...context}
          />
        )}
        {change.rowsRemoved.length > 0 && (
          <EntryLine
            label={t("run.tableRowsRemoved")}
            entries={change.rowsRemoved.map((row) => ({
              name: row.key,
              anchorIds: [row.anchorId],
            }))}
            {...context}
          />
        )}
        {change.rowsChanged.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[11px] text-muted-foreground">{t("run.tableRowsChanged")}</span>
            {change.rowsChanged.map((row) => (
              <div
                key={`${row.key}:${row.beforeLine}`}
                className="rounded-md border border-border/40 px-2 py-1.5"
              >
                <span className="font-mono text-[11.5px]">{row.key}</span>
                <div className="mt-1 space-y-1">
                  {row.columnsChanged.map((cell) => (
                    <div
                      key={String(cell.column)}
                      className="flex flex-wrap items-center gap-1.5 text-[11.5px]"
                    >
                      <span className="text-muted-foreground">{String(cell.column)}:</span>
                      <span className="font-mono">{cell.before}</span>
                      <ChevronRight className="size-3 text-muted-foreground" />
                      <span className="font-mono">{cell.after}</span>
                      <AnchorChip
                        anchorId={cell.beforeAnchorId}
                        anchorsById={context.anchorsById}
                        onAnchorClick={context.onAnchorClick}
                      />
                      <AnchorChip
                        anchorId={cell.afterAnchorId}
                        anchorsById={context.anchorsById}
                        onAnchorClick={context.onAnchorClick}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ChangeFactsProps extends ChipContext {
  readonly digest: DigestBundle;
}

/**
 * Tab 1 "Đã thay đổi" — the engine's change facts plus the value journeys that connect them
 * to code. Everything here is deterministic engine output; the AI never adds to this list.
 */
export function ChangeFacts({ digest, anchorsById, onAnchorClick }: ChangeFactsProps) {
  const { t } = useTranslation();
  const scripts = digest.changeFacts.filter(
    (fact): fact is DigestScriptChange => fact.kind === "script",
  );
  const tables = digest.changeFacts.filter(
    (fact): fact is DigestTableChange => fact.kind === "table",
  );

  return (
    <div className="space-y-5">
      <p className="text-[12px] text-muted-foreground">
        {t("run.changesStats", {
          files: digest.stats.filesChanged,
          added: digest.stats.symbolsAdded,
          removed: digest.stats.symbolsRemoved,
          changed: digest.stats.symbolsChanged,
        })}
        {" · "}
        {t("run.changesRows", {
          added: digest.stats.rowsAdded,
          removed: digest.stats.rowsRemoved,
          changed: digest.stats.rowsChanged,
        })}
      </p>

      {scripts.length === 0 && tables.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">{t("run.changesEmpty")}</p>
      ) : (
        <>
          {scripts.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-[13px] font-semibold">{t("run.scriptsTitle")}</h3>
              {scripts.map((change) => (
                <ScriptChangeCard
                  key={change.path}
                  change={change}
                  anchorsById={anchorsById}
                  onAnchorClick={onAnchorClick}
                />
              ))}
            </section>
          )}
          {tables.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-[13px] font-semibold">{t("run.tablesTitle")}</h3>
              {tables.map((change) => (
                <TableChangeCard
                  key={change.path}
                  change={change}
                  anchorsById={anchorsById}
                  onAnchorClick={onAnchorClick}
                />
              ))}
            </section>
          )}
        </>
      )}

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold">{t("run.journeysTitle")}</h3>
          <span className="text-[11.5px] text-muted-foreground">{t("run.journeysNote")}</span>
        </div>
        {digest.linked.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">{t("run.journeysEmpty")}</p>
        ) : (
          digest.linked.map((item) => (
            <div
              key={`${item.originKind}:${item.originLabel}:${item.anchorId ?? ""}`}
              className="rounded-lg border border-border/50 p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11.5px]">{item.originLabel}</span>
                <Badge variant="outline" className="h-5 px-1.5 text-[10.5px] font-normal uppercase">
                  {item.originKind}
                </Badge>
                {item.anchorId !== null && (
                  <AnchorChip
                    anchorId={item.anchorId}
                    anchorsById={anchorsById}
                    onAnchorClick={onAnchorClick}
                  />
                )}
              </div>
              {item.chains.length === 0 ? (
                <p className="mt-2 text-[11.5px] text-muted-foreground">
                  {item.note ?? t("run.journeysEmpty")}
                </p>
              ) : (
                item.chains.map((chain) => (
                  <div
                    key={chain.nodes.map((node) => `${node.anchorId}@${node.label}`).join("|")}
                    className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px]"
                  >
                    {chain.nodes.map((node, nodeIndex) => (
                      <span
                        key={`${node.anchorId}@${node.label}`}
                        className="inline-flex flex-wrap items-center gap-1"
                      >
                        {nodeIndex > 0 && <ChevronRight className="size-3 text-muted-foreground" />}
                        <span
                          className={node.confidence === "unknown" ? "text-muted-foreground" : ""}
                        >
                          {node.label}
                        </span>
                        <AnchorChip
                          anchorId={node.anchorId}
                          anchorsById={anchorsById}
                          onAnchorClick={onAnchorClick}
                        />
                      </span>
                    ))}
                  </div>
                ))
              )}
            </div>
          ))
        )}
      </section>
    </div>
  );
}

import type {
  Anchor,
  DigestBundle,
  DigestScriptChange,
  DigestTableChange,
} from "@craftland-qa/contracts";
import { cn } from "cn";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AnchorChip } from "@/components/report/finding-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const STATUS_LABEL_KEYS: Record<"added" | "removed" | "changed", string> = {
  added: "compare.statusAdded",
  removed: "compare.statusDeleted",
  changed: "compare.statusModified",
};

const STATUS_STYLES: Record<"added" | "removed" | "changed", string> = {
  added: "bg-positive/15 text-positive dark:text-positive",
  removed: "bg-danger/15 text-danger dark:text-danger",
  changed: "bg-warning/15 text-warning dark:text-warning",
};

const SYMBOL_KIND_LABEL_KEYS: Record<string, string> = {
  define: "run.symKindDefine",
  alias: "run.symKindAlias",
  enum: "run.symKindEnum",
  "enum-member": "run.symKindEnumMember",
  component: "run.symKindComponent",
  tuple: "run.symKindTuple",
  function: "run.symKindFunction",
  event: "run.symKindEvent",
  graph: "run.symKindGraph",
  "declare-graph": "run.symKindDeclareGraph",
  field: "run.symKindField",
  variable: "run.symKindVariable",
  parameter: "run.symKindParameter",
  "for-binding": "run.symKindForBinding",
};

/** Group order inside a bucket — structural first, noise (enum members) last. */
const KIND_ORDER = [
  "function",
  "event",
  "field",
  "enum",
  "enum-member",
  "define",
  "alias",
  "component",
  "tuple",
  "graph",
  "declare-graph",
  "variable",
  "parameter",
  "for-binding",
];

/** Files with more entries than this start collapsed; smaller ones stay open. */
const COLLAPSE_AT = 6;

/** Table rows listed by name before the "show more" control kicks in. */
const ROW_NAME_LIMIT = 20;

interface ChipContext {
  readonly anchorsById: ReadonlyMap<string, Anchor>;
  readonly onAnchorClick: (anchor: Anchor) => void;
}

interface Entry {
  readonly name: string;
  readonly kind: string;
  readonly anchorIds: readonly string[];
}

interface EntryGroup {
  readonly kind: string;
  readonly entries: readonly Entry[];
}

function kindRank(kind: string): number {
  const index = KIND_ORDER.indexOf(kind);
  return index === -1 ? KIND_ORDER.length : index;
}

function groupEntries(entries: readonly Entry[]): EntryGroup[] {
  const byKind = new Map<string, Entry[]>();
  for (const entry of entries) {
    const list = byKind.get(entry.kind);
    if (list === undefined) byKind.set(entry.kind, [entry]);
    else list.push(entry);
  }
  return [...byKind.entries()]
    .sort(([a], [b]) => kindRank(a) - kindRank(b) || (a < b ? -1 : a > b ? 1 : 0))
    .map(([kind, list]) => ({ kind, entries: list }));
}

function StatusBadge({ status }: { readonly status: "added" | "removed" | "changed" }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-micro font-medium ${STATUS_STYLES[status]}`}
    >
      {t(STATUS_LABEL_KEYS[status])}
    </span>
  );
}

/** One entry: the name plus its citation chip(s), compact — the file is already on screen. */
function EntryChip({ entry, ...context }: { readonly entry: Entry } & ChipContext) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted/40 px-1.5 py-0.5">
      <span className="font-mono text-meta">{entry.name}</span>
      {entry.anchorIds.map((anchorId, index) => (
        <span key={anchorId} className="inline-flex items-center gap-1">
          {index > 0 && <ChevronRight className="size-3 text-muted-foreground" />}
          <AnchorChip
            anchorId={anchorId}
            anchorsById={context.anchorsById}
            onAnchorClick={context.onAnchorClick}
            compact
          />
        </span>
      ))}
    </span>
  );
}

/** Group label in plain language: kind + verb, e.g. "giá trị enum mới:". */
function GroupLabel({ kind, verbKey }: { readonly kind: string; readonly verbKey: string }) {
  const { t } = useTranslation();
  const labelKey = SYMBOL_KIND_LABEL_KEYS[kind];
  const label = labelKey === undefined ? kind : t(labelKey);
  return (
    <span className="text-micro text-muted-foreground">
      {t("run.groupLabel", { label, verb: t(verbKey) })}
    </span>
  );
}

function BucketRows({
  verbKey,
  entries,
  ...context
}: { readonly verbKey: string; readonly entries: readonly Entry[] } & ChipContext) {
  const groups = groupEntries(entries);
  return (
    <>
      {groups.map((group) => (
        <div key={`${verbKey}:${group.kind}`} className="flex flex-wrap items-center gap-1.5">
          <GroupLabel kind={group.kind} verbKey={verbKey} />
          {group.entries.map((entry) => (
            <EntryChip
              key={`${entry.name}:${entry.anchorIds.join(",")}`}
              entry={entry}
              anchorsById={context.anchorsById}
              onAnchorClick={context.onAnchorClick}
            />
          ))}
        </div>
      ))}
    </>
  );
}

function ScriptChangeCard({
  change,
  ...context
}: { readonly change: DigestScriptChange } & ChipContext) {
  const { t } = useTranslation();
  const added: Entry[] = change.symbolsAdded.map((symbol) => ({
    name: symbol.name,
    kind: symbol.symbolKind,
    anchorIds: [symbol.anchorId],
  }));
  const removed: Entry[] = change.symbolsRemoved.map((symbol) => ({
    name: symbol.name,
    kind: symbol.symbolKind,
    anchorIds: [symbol.anchorId],
  }));
  const changed: Entry[] = change.symbolsChanged.map((symbol) => ({
    name: symbol.name,
    kind: symbol.symbolKind,
    anchorIds: [symbol.beforeAnchorId, symbol.afterAnchorId],
  }));
  const total = added.length + removed.length + changed.length;
  const [expanded, setExpanded] = useState(total <= COLLAPSE_AT);

  const summary = [
    ...groupEntries(added).map((group) => ({ group, verbKey: "run.verbAdded" })),
    ...groupEntries(changed).map((group) => ({ group, verbKey: "run.verbChanged" })),
    ...groupEntries(removed).map((group) => ({ group, verbKey: "run.verbRemoved" })),
  ]
    .map(({ group, verbKey }) => {
      const labelKey = SYMBOL_KIND_LABEL_KEYS[group.kind];
      const label = labelKey === undefined ? group.kind : t(labelKey);
      return t("run.summaryPart", {
        count: group.entries.length,
        label,
        verb: t(verbKey),
      });
    })
    .join(" · ");

  return (
    <div className="rounded-lg border border-border/50">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full flex-wrap items-center gap-2 p-3 text-left"
      >
        <StatusBadge status={change.status} />
        <span className="truncate font-mono text-meta" title={change.path}>
          {change.path}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <span className="text-micro text-muted-foreground">{summary}</span>
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </span>
      </button>
      {expanded && (
        <div className="space-y-1.5 border-t border-border/40 p-3">
          <BucketRows verbKey="run.verbAdded" entries={added} {...context} />
          <BucketRows verbKey="run.verbChanged" entries={changed} {...context} />
          <BucketRows verbKey="run.verbRemoved" entries={removed} {...context} />
        </div>
      )}
    </div>
  );
}

/** A bucket of table row names with a cap and a show-more control. */
function RowNameList({
  label,
  entries,
  ...context
}: { readonly label: string; readonly entries: readonly Entry[] } & ChipContext) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? entries : entries.slice(0, ROW_NAME_LIMIT);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-micro text-muted-foreground">{label}</span>
      {shown.map((entry) => (
        <EntryChip
          key={`${entry.name}:${entry.anchorIds.join(",")}`}
          entry={entry}
          anchorsById={context.anchorsById}
          onAnchorClick={context.onAnchorClick}
        />
      ))}
      {entries.length > ROW_NAME_LIMIT && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-5 px-1.5 text-micro"
          onClick={() => setShowAll(!showAll)}
        >
          {showAll
            ? t("run.showLess")
            : t("run.showMore", { count: entries.length - ROW_NAME_LIMIT })}
        </Button>
      )}
    </div>
  );
}

function TableChangeCard({
  change,
  ...context
}: { readonly change: DigestTableChange } & ChipContext) {
  const { t } = useTranslation();
  const total = change.rowsAdded.length + change.rowsRemoved.length + change.rowsChanged.length;
  const [expanded, setExpanded] = useState(total <= COLLAPSE_AT * 2);

  const rowEntries = (rows: DigestTableChange["rowsAdded"]): Entry[] =>
    rows.map((row) => ({ name: row.key, kind: "row", anchorIds: [row.anchorId] }));
  const addedEntries = rowEntries(change.rowsAdded);
  const removedEntries = rowEntries(change.rowsRemoved);

  return (
    <div className="rounded-lg border border-border/50">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full flex-wrap items-center gap-2 p-3 text-left"
      >
        <StatusBadge status={change.status} />
        <span className="truncate font-mono text-meta" title={change.path}>
          {change.path}
        </span>
        {change.headerChanged && (
          <Badge variant="outline" className="h-5 px-1.5 text-micro font-normal">
            {t("run.headerChanged")}
          </Badge>
        )}
        <span className="ml-auto flex items-center gap-2">
          <span className="text-micro text-muted-foreground">
            {t("run.tableSummary", {
              added: change.rowsAdded.length,
              removed: change.rowsRemoved.length,
              changed: change.rowsChanged.length,
            })}
          </span>
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </span>
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-border/40 p-3">
          {addedEntries.length > 0 && (
            <RowNameList label={t("run.tableRowsAdded")} entries={addedEntries} {...context} />
          )}
          {removedEntries.length > 0 && (
            <RowNameList label={t("run.tableRowsRemoved")} entries={removedEntries} {...context} />
          )}
          {change.rowsChanged.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-micro text-muted-foreground">{t("run.tableRowsChanged")}</span>
              {change.rowsChanged.map((row) => (
                <div
                  key={`${row.key}:${row.beforeLine}`}
                  className="rounded-md border border-border/40 px-2 py-1.5"
                >
                  <span className="font-mono text-meta">{row.key}</span>
                  <div className="mt-1 space-y-1">
                    {row.columnsChanged.map((cell) => (
                      <div
                        key={String(cell.column)}
                        className="flex flex-wrap items-center gap-1.5 text-meta"
                      >
                        <span className="text-muted-foreground">{String(cell.column)}:</span>
                        <span className="font-mono">{cell.before}</span>
                        <ChevronRight className="size-3 text-muted-foreground" />
                        <span className="font-mono">{cell.after}</span>
                        <AnchorChip
                          anchorId={cell.beforeAnchorId}
                          anchorsById={context.anchorsById}
                          onAnchorClick={context.onAnchorClick}
                          compact
                        />
                        <AnchorChip
                          anchorId={cell.afterAnchorId}
                          anchorsById={context.anchorsById}
                          onAnchorClick={context.onAnchorClick}
                          compact
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ChangeFactsProps extends ChipContext {
  readonly digest: DigestBundle;
}

/**
 * Tab 1 "Đã thay đổi" — the engine's change facts plus the value journeys that connect them
 * to code. Summary-first and collapsible: file headers carry plain-language group counts, the
 * detail expands on demand, and citation chips stay compact because the file is on screen.
 * Everything here is deterministic engine output; the AI never adds to this list.
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
      <div className="space-y-1">
        <p className="text-meta text-muted-foreground">
          {t("run.changesSummary", {
            files: digest.stats.filesChanged,
            added: digest.stats.symbolsAdded,
            removed: digest.stats.symbolsRemoved,
            changed: digest.stats.symbolsChanged,
          })}
        </p>
        <p className="text-meta text-muted-foreground">
          {t("run.changesRows", {
            added: digest.stats.rowsAdded,
            removed: digest.stats.rowsRemoved,
            changed: digest.stats.rowsChanged,
          })}
        </p>
        <p className="text-meta text-muted-foreground">{t("run.changesScope")}</p>
      </div>

      {scripts.length === 0 && tables.length === 0 ? (
        <p className="text-body text-muted-foreground">{t("run.changesEmpty")}</p>
      ) : (
        <>
          {scripts.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-body font-semibold">{t("run.scriptsTitle")}</h3>
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
              <h3 className="text-body font-semibold">{t("run.tablesTitle")}</h3>
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

      <section>
        <details className="rounded-lg border border-border/50">
          <summary className="flex cursor-pointer flex-wrap items-center gap-2 p-3 text-body font-semibold">
            {t("run.journeysTitle")}
            <span className="text-meta font-normal text-muted-foreground">
              {t("run.journeysCount", { count: digest.linked.length })}
            </span>
          </summary>
          <div className="space-y-2 border-t border-border/40 p-3">
            <p className="text-meta text-muted-foreground">{t("run.journeysNote")}</p>
            {digest.linked.length === 0 ? (
              <p className="text-body text-muted-foreground">{t("run.journeysEmpty")}</p>
            ) : (
              digest.linked.map((item) => (
                <div
                  key={`${item.originKind}:${item.originLabel}:${item.anchorId ?? ""}`}
                  className="rounded-lg border border-border/50 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-meta">{item.originLabel}</span>
                    <Badge
                      variant="outline"
                      className="h-5 px-1.5 text-micro font-normal uppercase"
                    >
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
                    <p className="mt-2 text-meta text-muted-foreground">
                      {item.note ?? t("run.journeysEmpty")}
                    </p>
                  ) : (
                    item.chains.map((chain) => (
                      <div
                        key={chain.nodes.map((node) => `${node.anchorId}@${node.label}`).join("|")}
                        className="mt-2 flex flex-wrap items-center gap-1.5 text-meta"
                      >
                        {chain.nodes.map((node, nodeIndex) => (
                          <span
                            key={`${node.anchorId}@${node.label}`}
                            className="inline-flex flex-wrap items-center gap-1"
                          >
                            {nodeIndex > 0 && (
                              <ChevronRight className="size-3 text-muted-foreground" />
                            )}
                            <span
                              className={
                                node.confidence === "unknown" ? "text-muted-foreground" : ""
                              }
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
          </div>
        </details>
      </section>
    </div>
  );
}

import type { DigestQuantity, DigestScriptChange, DigestTableChange } from "@silentskip/contracts";
import { type AnchorRegistry, compareStrings, type DigestSide, rowSpan } from "./shared.js";

/** Named quantities (fact-id store, decision #28) — per-file counts and changed values. */
export function collectQuantities(
  changeFacts: readonly (DigestScriptChange | DigestTableChange)[],
  base: DigestSide,
  current: DigestSide,
  registry: AnchorRegistry,
): DigestQuantity[] {
  const byId = new Map<string, DigestQuantity>();
  const add = (quantity: DigestQuantity): void => {
    if (!byId.has(quantity.id)) byId.set(quantity.id, quantity);
  };
  for (const fact of changeFacts) {
    if (fact.kind === "script") {
      add({
        id: `q:symbol-count|B|${fact.path}|added`,
        kind: "symbol-count",
        subject: `${fact.path} symbols added`,
        value: String(fact.symbolsAdded.length),
        ref: "B",
        anchorId: null,
        file: fact.path,
      });
      add({
        id: `q:symbol-count|A|${fact.path}|removed`,
        kind: "symbol-count",
        subject: `${fact.path} symbols removed`,
        value: String(fact.symbolsRemoved.length),
        ref: "A",
        anchorId: null,
        file: fact.path,
      });
      add({
        id: `q:symbol-count|${fact.path}|changed`,
        kind: "symbol-count",
        subject: `${fact.path} symbols changed`,
        value: String(fact.symbolsChanged.length),
        ref: null,
        anchorId: null,
        file: fact.path,
      });
      for (const change of fact.symbolsChanged) {
        if (change.beforeValue !== undefined) {
          add({
            id: `q:value|A|${fact.path}|${change.name}`,
            kind: "value",
            subject: `${fact.path} ${change.name} (before)`,
            value: change.beforeValue,
            ref: "A",
            anchorId: change.beforeAnchorId,
            file: fact.path,
          });
        }
        if (change.afterValue !== undefined) {
          add({
            id: `q:value|B|${fact.path}|${change.name}`,
            kind: "value",
            subject: `${fact.path} ${change.name} (after)`,
            value: change.afterValue,
            ref: "B",
            anchorId: change.afterAnchorId,
            file: fact.path,
          });
        }
      }
      continue;
    }
    const beforeHeader = base.tables.get(fact.path)?.rows[0];
    const afterHeader = current.tables.get(fact.path)?.rows[0];
    const beforeSource = base.sources.get(fact.path);
    const afterSource = current.sources.get(fact.path);
    if (fact.columns.before !== null && beforeHeader !== undefined && beforeSource !== undefined) {
      add({
        id: `q:column-count|A|${fact.path}`,
        kind: "column-count",
        subject: `${fact.path} columns (before)`,
        value: String(fact.columns.before),
        ref: "A",
        anchorId: registry.add("A", fact.path, beforeSource, rowSpan(beforeHeader), "csv"),
        file: fact.path,
      });
    }
    if (fact.columns.after !== null && afterHeader !== undefined && afterSource !== undefined) {
      add({
        id: `q:column-count|B|${fact.path}`,
        kind: "column-count",
        subject: `${fact.path} columns (after)`,
        value: String(fact.columns.after),
        ref: "B",
        anchorId: registry.add("B", fact.path, afterSource, rowSpan(afterHeader), "csv"),
        file: fact.path,
      });
    }
    add({
      id: `q:row-count|B|${fact.path}|added`,
      kind: "row-count",
      subject: `${fact.path} rows added`,
      value: String(fact.rowsAdded.length),
      ref: "B",
      anchorId: null,
      file: fact.path,
    });
    add({
      id: `q:row-count|A|${fact.path}|removed`,
      kind: "row-count",
      subject: `${fact.path} rows removed`,
      value: String(fact.rowsRemoved.length),
      ref: "A",
      anchorId: null,
      file: fact.path,
    });
    add({
      id: `q:row-count|${fact.path}|changed`,
      kind: "row-count",
      subject: `${fact.path} rows changed`,
      value: String(fact.rowsChanged.length),
      ref: null,
      anchorId: null,
      file: fact.path,
    });
  }
  return [...byId.values()].sort((a, b) => compareStrings(a.id, b.id));
}

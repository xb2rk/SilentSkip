import type { DigestBody } from "@silentskip/contracts";
import type { DeltaBundle } from "../delta/index.js";
import type { FactSpan } from "../facts/index.js";
import type { DigestSide } from "./shared.js";
import { DEFAULT_BODY_BYTES_PER_FUNCTION } from "./types.js";

/**
 * Longest prefix of `text` whose UTF-8 encoding fits `maxBytes` — byte budgets are real bytes,
 * not UTF-16 code units (Vietnamese/CJK bodies are 2–3 bytes per unit). Never splits a surrogate
 * pair.
 */
export function truncateToUtf8Bytes(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, mid), "utf8") <= maxBytes) low = mid;
    else high = mid - 1;
  }
  const last = low > 0 ? text.charCodeAt(low - 1) : 0;
  const end = last >= 0xd800 && last <= 0xdbff ? low - 1 : low;
  return text.slice(0, end);
}

/**
 * Collects function-body reading material (E7.5): bodies of functions added in B and of changed
 * functions (current side). Before this, added symbols reached the AI as name-only anchors, so
 * new systems could only be described generically. Deterministic order (delta script order,
 * added before changed), byte-budgeted, truncation never silent (`truncated` flag + manifest).
 */
export function collectBodies(
  delta: DeltaBundle,
  current: DigestSide,
  bodyBudgetBytes: number,
): { bodies: DigestBody[]; truncated: number; dropped: number } {
  const bodies: DigestBody[] = [];
  let truncated = 0;
  let dropped = 0;
  let bytes = 0;
  const push = (
    file: string,
    symbolId: string,
    name: string,
    kind: string,
    span: FactSpan,
    source: string | undefined,
  ): void => {
    if (source === undefined) return;
    const raw = source.slice(span.offset, span.offset + span.length);
    const rawBytes = Buffer.byteLength(raw, "utf8");
    const isTruncated = rawBytes > DEFAULT_BODY_BYTES_PER_FUNCTION;
    const text = isTruncated ? truncateToUtf8Bytes(raw, DEFAULT_BODY_BYTES_PER_FUNCTION) : raw;
    const textBytes = Buffer.byteLength(text, "utf8");
    if (bytes + textBytes > bodyBudgetBytes) {
      dropped += 1;
      return;
    }
    bytes += textBytes;
    if (isTruncated) truncated += 1;
    bodies.push({
      file,
      symbolId,
      name,
      kind,
      side: "B",
      lineStart: span.line,
      lineEnd: span.endLine,
      truncated: isTruncated,
      text,
    });
  };
  for (const script of delta.scripts) {
    if (script.status === "removed") continue;
    const source = current.sources.get(script.path);
    for (const symbol of script.symbolsAdded) {
      if (symbol.kind !== "function" && symbol.kind !== "event") continue;
      push(script.path, symbol.id, symbol.name, symbol.kind, symbol.span, source);
    }
  }
  for (const script of delta.scripts) {
    if (script.status === "removed") continue;
    const source = current.sources.get(script.path);
    for (const change of script.symbolsChanged) {
      if (change.kind !== "function" && change.kind !== "event") continue;
      const symbolId = `${script.path}#${change.name}@${change.afterSpan.offset}`;
      push(script.path, symbolId, change.name, change.kind, change.afterSpan, source);
    }
  }
  return { bodies, truncated, dropped };
}

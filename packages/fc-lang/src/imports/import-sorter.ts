/**
 * Deterministic import sorting with attached comment preservation and group separation.
 *
 * @see CODING_CONVENTION.md §Imports
 */

import { TokenId } from "../grammar/token-vocabulary.generated.js";
import type { Token } from "../lex/token.js";
import type { ImportNode } from "../syntax/declarations.js";

type ImportGroup = "standard" | "contracts" | "depth";

interface ImportRecord {
  readonly blockEndOffset: number;
  readonly blockStartLine: number;
  readonly group: ImportGroup;
  readonly lineIndex: number;
  readonly path: string;
  readonly source: string;
}

interface LineInfo {
  readonly contentEnd: number;
  readonly eol: string;
  readonly start: number;
}

interface Interval {
  readonly end: number;
  readonly start: number;
}

const IMPORT_GROUP_ORDER: Readonly<Record<ImportGroup, number>> = {
  standard: 0,
  contracts: 1,
  depth: 2,
};

/**
 * Normalizes and sorts the parsed file-header imports into standard groups.
 * Returns the source text with sorted imports. If fewer than 2 imports exist or if
 * the imports are already sorted, returns the original source string unmodified.
 */
export function sortHeaderImports(
  source: string,
  tokens: readonly Token[],
  imports: readonly ImportNode[],
): string {
  if (imports.length < 2) return source;

  const lines = splitLines(source);
  const commentIntervals = commentIntervalsByLine(lines, tokens);
  const records = imports.flatMap((node) => importRecord(source, lines, commentIntervals, tokens, node));
  if (records.length < 2) return source;

  const sorted = [...records].sort(compareImports);
  const first = records[0];
  const last = records.at(-1);
  if (!first || !last) return source;

  const lineEnding = findLineEnding(lines, records) ?? "\n";
  const rendered = renderRun(sorted, lineEnding);
  const startOffset = lines[first.blockStartLine]?.start ?? 0;
  if (rendered === source.slice(startOffset, last.blockEndOffset)) {
    return source;
  }
  return source.slice(0, startOffset) + rendered + source.slice(last.blockEndOffset);
}

function importRecord(
  source: string,
  lines: readonly LineInfo[],
  commentIntervals: readonly (readonly Interval[])[],
  tokens: readonly Token[],
  node: ImportNode,
): ImportRecord[] {
  const importToken = tokens[node.importTokenIndex];
  const pathToken = node.pathTokenIndex === undefined ? undefined : tokens[node.pathTokenIndex];
  if (!importToken || !pathToken) return [];
  const lineIndex = importToken.range.start.line;
  const line = lines[lineIndex];
  if (!line) return [];
  const blockStartLine = attachedCommentStart(source, lines, commentIntervals, lineIndex);
  const path = decodeImportPath(pathToken.text);
  return [
    {
      blockEndOffset: line.contentEnd,
      blockStartLine,
      group: classifyImport(path),
      lineIndex,
      path,
      source: source.slice(lines[blockStartLine]?.start ?? line.start, line.contentEnd),
    },
  ];
}

function attachedCommentStart(
  source: string,
  lines: readonly LineInfo[],
  commentIntervals: readonly (readonly Interval[])[],
  lineIndex: number,
): number {
  let start = lineIndex;
  while (start > 0 && isCommentOnlyLine(source, lines[start - 1], commentIntervals[start - 1] ?? [])) {
    start -= 1;
  }
  return start;
}

function commentIntervalsByLine(
  lines: readonly LineInfo[],
  tokens: readonly Token[],
): readonly (readonly Interval[])[] {
  const intervals = lines.map(() => [] as Interval[]);
  for (const token of tokens) {
    if (!isCommentToken(token)) continue;
    const firstLine = token.range.start.line;
    const lastLine = Math.min(token.range.end.line, lines.length - 1);
    for (let lineIndex = firstLine; lineIndex <= lastLine; lineIndex += 1) {
      const line = lines[lineIndex];
      if (!line) continue;
      const start = Math.max(line.start, token.range.start.offset);
      const end = Math.min(line.contentEnd, token.range.end.offset);
      if (end > start) intervals[lineIndex]?.push({ end, start });
    }
  }
  return intervals;
}

function isCommentOnlyLine(
  source: string,
  line: LineInfo | undefined,
  intervals: readonly Interval[],
): boolean {
  if (!line) return false;
  const text = source.slice(line.start, line.contentEnd);
  let hasCommentText = false;
  for (let offset = 0; offset < text.length; offset += 1) {
    if (/\s/u.test(text[offset] ?? "")) continue;
    const absolute = line.start + offset;
    if (!intervals.some((interval) => absolute >= interval.start && absolute < interval.end)) {
      return false;
    }
    hasCommentText = true;
  }
  return hasCommentText;
}

function isCommentToken(token: Token): boolean {
  return (
    token.kind === TokenId.COMMENT ||
    token.kind === TokenId.COMMENT_NLSEMI ||
    token.kind === TokenId.LINE_COMMENT ||
    token.kind === TokenId.LINE_COMMENT_NLSEMI
  );
}

function classifyImport(path: string): ImportGroup {
  const normalized = normalizeSlashes(path);
  if (!isRelativeSpecifier(normalized)) return "standard";
  const segments = normalized.split("/").filter(Boolean);
  return segments.some((segment) => segment.toLowerCase() === "contracts") ? "contracts" : "depth";
}

function compareImports(left: ImportRecord, right: ImportRecord): number {
  const groupOrder = IMPORT_GROUP_ORDER[left.group] - IMPORT_GROUP_ORDER[right.group];
  if (groupOrder !== 0) return groupOrder;
  if (left.group === "standard") {
    const reservedOrder = standardReservedOrder(left.path) - standardReservedOrder(right.path);
    if (reservedOrder !== 0) return reservedOrder;
  }
  if (left.group === "depth") {
    const leftSegments = normalizeSlashes(left.path).split("/").filter(Boolean);
    const rightSegments = normalizeSlashes(right.path).split("/").filter(Boolean);
    const depthOrder = relativeDepth(rightSegments) - relativeDepth(leftSegments);
    if (depthOrder !== 0) return depthOrder;
  }
  return (
    compareText(canonicalPath(left.path), canonicalPath(right.path)) ||
    compareText(left.source, right.source) ||
    left.lineIndex - right.lineIndex
  );
}

function decodeImportPath(literal: string): string {
  const body = literal.slice(1, -1);
  return body.replaceAll("\\/", "/");
}

function normalizeSlashes(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/{2,}/gu, "/");
}

function canonicalPath(path: string): string {
  return normalizeSlashes(path).replace(/^\.\//u, "");
}

function isRelativeSpecifier(path: string): boolean {
  return path === "." || path === ".." || path.startsWith("./") || path.startsWith("../");
}

function relativeDepth(segments: readonly string[]): number {
  let depth = 0;
  for (const segment of segments) {
    if (segment !== "..") break;
    depth += 1;
  }
  return depth;
}

function standardReservedOrder(path: string): number {
  const normalized = normalizeSlashes(path).toLowerCase();
  if (normalized === "stdlibrary.fcc") return 1;
  if (normalized === "editorgenlib.fcc") return 2;
  return 0;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" }) || left.localeCompare(right, "en");
}

function findLineEnding(lines: readonly LineInfo[], records: readonly ImportRecord[]): string | undefined {
  for (const record of records) {
    const ending = lines[record.lineIndex]?.eol;
    if (ending) return ending;
  }
  return undefined;
}

function renderRun(records: readonly ImportRecord[], lineEnding: string): string {
  let output = "";
  for (const [index, record] of records.entries()) {
    if (index > 0) {
      const previous = records[index - 1];
      output += lineEnding.repeat(previous !== undefined && previous.group !== record.group ? 2 : 1);
    }
    output += record.source;
  }
  return output;
}

function splitLines(source: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let start = 0;
  while (start < source.length || lines.length === 0) {
    let contentEnd = start;
    while (contentEnd < source.length && source[contentEnd] !== "\r" && source[contentEnd] !== "\n") {
      contentEnd += 1;
    }
    let end = contentEnd;
    if (source[contentEnd] === "\r") {
      end += source[contentEnd + 1] === "\n" ? 2 : 1;
    } else if (source[contentEnd] === "\n") {
      end += 1;
    }
    lines.push({ contentEnd, eol: source.slice(contentEnd, end), start });
    if (end >= source.length) break;
    start = end;
  }
  return lines;
}

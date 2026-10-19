import {
  type Anchor,
  type AnchorLoc,
  LOCALIZATION_SCHEMA_VERSION,
  type LocalizationLanguageCoverage,
  type LocalizationReport,
  type LocalizationSeverity,
  type LocalizationTableReport,
  type LocalizationTableStatus,
} from "@silentskip/contracts";
import type { CsvRow, CsvTable } from "../csv/index.js";
import { cellSpan, delimiterForPath, isBlankRow, parseCsv, rowSpan } from "../csv/index.js";
import { gitBlobSha } from "../digest/build.js";
import type { FactSpan, SourceInput } from "../facts/index.js";

/**
 * LOC-01 deterministic localization report (E9).
 *
 * Localization tables are discovered from the filesystem: a path whose basename is
 * `key.csv` / `publishing_key.csv` (anything ending in `key.csv`) with a `Key` header and
 * at least two known language columns. There is no project-specific table list and no
 * filename hardcoding beyond the shared `*key.csv` naming convention.
 *
 * `LanguageKey` is an optional metadata row used by some generated projects. It is skipped
 * only when the first cell is exactly `LanguageKey`; the header itself is the language row.
 */

const TABLE_EXTENSION = /\.(csv|tsv)$/iu;
const KEY_FILE = /(?:^|[/_-])key\.(?:csv|tsv)$/iu;

const KNOWN_LANGUAGE_NAMES = new Set([
  "english",
  "vietnamese",
  "thai",
  "traditional chinese",
  "simplified chinese",
  "chinese",
  "indonesia",
  "indonesian",
  "brazilian portuguese",
  "portuguese",
  "spanish",
  "russian",
  "french",
  "german",
  "turkish",
  "hindi",
  "arabic",
  "bengali",
  "malay",
  "burmese",
  "urdu",
  "romanian",
  "japanese",
  "korean",
  "italian",
]);

const MAX_SAMPLES = 10;
const MAX_WITNESSES = 5;

/** One side of a localization comparison. `ref` is the anchor side, `label` the git ref. */
export interface LocalizationSideInput {
  readonly ref: "A" | "B";
  readonly label: string;
  readonly sources: readonly SourceInput[];
}

/** A structural localization table discovered from a CSV file. */
export interface DetectedLocalizationTable {
  readonly path: string;
  readonly source: string;
  readonly table: CsvTable;
  readonly sourceColumn: string;
  readonly sourceIndex: number;
  readonly languages: readonly { readonly column: string; readonly index: number }[];
}

/** An anchor before it is materialized: report builders and checks resolve it differently. */
export interface LocalizationAnchorRef {
  readonly ref: "A" | "B";
  readonly file: string;
  readonly span: FactSpan;
  readonly loc?: AnchorLoc;
}

export interface LocalizationIssueDraft {
  readonly id: string;
  readonly kind:
    | "duplicate-key"
    | "empty-key"
    | "key-whitespace"
    | "empty-source"
    | "empty-translation"
    | "placeholder-mismatch"
    | "key-added"
    | "key-removed";
  readonly severity: LocalizationSeverity;
  readonly table: string;
  readonly key?: string;
  readonly column?: string;
  readonly count: number;
  readonly samples: readonly string[];
  readonly anchors: readonly LocalizationAnchorRef[];
}

export interface LocalizationTableAnalysis {
  readonly path: string;
  readonly status: LocalizationTableStatus;
  readonly sourceColumn: string;
  readonly keyCount: number;
  readonly languageCount: number;
  readonly metadataRowsSkipped: number;
  readonly duplicateKeyCount: number;
  readonly emptyKeyCount: number;
  readonly whitespaceKeyCount: number;
  readonly emptySourceCount: number;
  readonly emptyTranslationCount: number;
  readonly placeholderMismatchCount: number;
  readonly addedKeyCount: number;
  readonly removedKeyCount: number;
  readonly coverage: readonly LocalizationLanguageCoverage[];
  readonly issues: readonly LocalizationIssueDraft[];
}

function normalizeLanguage(name: string): string {
  return name.trim().toLowerCase();
}

function isKnownLanguage(name: string): boolean {
  return KNOWN_LANGUAGE_NAMES.has(normalizeLanguage(name));
}

/** Returns the detected localization table or `undefined` when the shape does not match. */
export function detectLocalizationTable(
  path: string,
  source: string,
  table: CsvTable,
): DetectedLocalizationTable | undefined {
  if (!KEY_FILE.test(path)) return undefined;
  const header = table.rows[0];
  if (header === undefined) return undefined;
  const cells = header.cells.map((cell) => cell.text.trim());
  if (cells[0]?.toLowerCase() !== "key") return undefined;

  const languages = cells
    .map((column, index) => ({ column, index }))
    .filter((entry) => entry.index > 0 && entry.column !== "" && isKnownLanguage(entry.column));
  if (languages.length < 2) return undefined;

  const sourceEntry = languages.find((entry) => normalizeLanguage(entry.column) === "english");
  const selected = sourceEntry ?? languages[0];
  if (selected === undefined) return undefined;
  return {
    path,
    source,
    table,
    sourceColumn: selected.column,
    sourceIndex: selected.index,
    languages,
  };
}

function cellText(row: CsvRow, index: number): string {
  return row.cells[index]?.text.trim() ?? "";
}

function anchorRef(
  ref: "A" | "B",
  file: string,
  span: FactSpan,
  loc?: AnchorLoc,
): LocalizationAnchorRef {
  return { ref, file, span, ...(loc === undefined ? {} : { loc }) };
}

function headerAnchor(detected: DetectedLocalizationTable, ref: "A" | "B"): LocalizationAnchorRef {
  const header = detected.table.rows[0];
  if (header === undefined) throw new Error(`Localization table has no header: ${detected.path}`);
  return anchorRef(ref, detected.path, rowSpan(header));
}

function rowAnchor(
  detected: DetectedLocalizationTable,
  row: CsvRow,
  key: string,
  ref: "A" | "B" = "B",
): LocalizationAnchorRef {
  return anchorRef(ref, detected.path, rowSpan(row), { rowKey: key });
}

function cellAnchor(
  detected: DetectedLocalizationTable,
  row: CsvRow,
  cellIndex: number,
  key: string,
  column: string,
  ref: "A" | "B" = "B",
): LocalizationAnchorRef | undefined {
  const cell = row.cells[cellIndex];
  if (cell === undefined) return undefined;
  return anchorRef(ref, detected.path, cellSpan(cell), { rowKey: key, column });
}

function uniqAnchors(anchors: readonly LocalizationAnchorRef[]): LocalizationAnchorRef[] {
  const seen = new Set<string>();
  const out: LocalizationAnchorRef[] = [];
  for (const anchor of anchors) {
    const id = [
      anchor.ref,
      anchor.file,
      String(anchor.span.line),
      String(anchor.span.endLine),
      String(anchor.loc?.rowKey ?? ""),
      String(anchor.loc?.column ?? ""),
    ].join(":");
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(anchor);
  }
  return out;
}

function issueId(path: string, suffix: string): string {
  return `LOC-01|B|${path}|${suffix}`;
}

function sampleKeys(keys: readonly string[]): string[] {
  return keys.slice(0, MAX_SAMPLES);
}

function placeholderTokens(text: string): string[] {
  return [...text.matchAll(/\{\d+\}|%(?:\d+\$)?[sdif]/gu)].map((match) => match[0]).sort();
}

function samePlaceholders(source: string, target: string): boolean {
  const left = placeholderTokens(source);
  const right = placeholderTokens(target);
  if (left.length !== right.length) return false;
  return left.every((token, index) => token === right[index]);
}

interface KeyRow {
  readonly row: CsvRow;
  readonly rawKey: string;
  readonly key: string;
}

function keyRows(detected: DetectedLocalizationTable): {
  rows: KeyRow[];
  metadataRowsSkipped: number;
} {
  let metadataRowsSkipped = 0;
  const rows: KeyRow[] = [];
  for (const row of detected.table.rows.slice(1)) {
    if (isBlankRow(row)) continue;
    const rawKey = row.cells[0]?.text ?? "";
    const key = rawKey.trim();
    if (key === "LanguageKey") {
      metadataRowsSkipped += 1;
      continue;
    }
    rows.push({ row, rawKey, key });
  }
  return { rows, metadataRowsSkipped };
}

function duplicateKeyGroups(rows: readonly KeyRow[]): { key: string; rows: KeyRow[] }[] {
  const groups = new Map<string, KeyRow[]>();
  for (const row of rows) {
    if (row.key === "") continue;
    const list = groups.get(row.key) ?? [];
    list.push(row);
    groups.set(row.key, list);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({ key, rows: list }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function coverageFor(
  detected: DetectedLocalizationTable,
  rows: readonly KeyRow[],
): LocalizationLanguageCoverage[] {
  return detected.languages.map((language) => {
    let filled = 0;
    for (const entry of rows) {
      if (cellText(entry.row, language.index) !== "") filled += 1;
    }
    const total = rows.length;
    const empty = total - filled;
    const percent = total === 0 ? 100 : Math.round((filled / total) * 1000) / 10;
    return { column: language.column, filled, empty, total, percent };
  });
}

function keySet(rows: readonly KeyRow[]): Set<string> {
  const set = new Set<string>();
  for (const row of rows) if (row.key !== "") set.add(row.key);
  return set;
}

/**
 * Analyze one localization table against an optional base table. All counts are exact
 * observations; placeholder checks use a multiset, so repeated tokens must match one-for-one.
 */
export function analyzeLocalizationTable(
  detected: DetectedLocalizationTable,
  base?: {
    readonly source: string;
    readonly table: CsvTable;
    readonly detected: DetectedLocalizationTable;
  },
): LocalizationTableAnalysis {
  const { rows, metadataRowsSkipped } = keyRows(detected);
  const keys = rows.filter((row) => row.key !== "");
  const duplicates = duplicateKeyGroups(rows);
  const whitespaceRows = rows.filter((row) => row.key !== "" && row.rawKey !== row.key);
  const emptyKeyRows = rows.filter((row) => row.key === "");
  const issues: LocalizationIssueDraft[] = [];
  const header = headerAnchor(detected, "B");
  const byKey = new Map(rows.map((row) => [row.key, row]));

  if (emptyKeyRows.length > 0) {
    issues.push({
      id: issueId(detected.path, "empty-key"),
      kind: "empty-key",
      severity: "major",
      table: detected.path,
      count: emptyKeyRows.length,
      samples: emptyKeyRows.slice(0, MAX_SAMPLES).map((row) => `line ${row.row.line}`),
      anchors: uniqAnchors([
        header,
        ...emptyKeyRows.slice(0, MAX_WITNESSES).map((row) => rowAnchor(detected, row.row, "")),
      ]),
    });
  }

  if (duplicates.length > 0) {
    const witnesses = duplicates.flatMap((group) => group.rows.slice(0, MAX_WITNESSES));
    issues.push({
      id: issueId(detected.path, "duplicate-key"),
      kind: "duplicate-key",
      severity: "major",
      table: detected.path,
      count: duplicates.length,
      samples: duplicates.slice(0, MAX_SAMPLES).map((group) => group.key),
      anchors: uniqAnchors([
        header,
        ...witnesses.slice(0, MAX_WITNESSES).map((row) => rowAnchor(detected, row.row, row.key)),
      ]),
    });
  }

  if (whitespaceRows.length > 0) {
    issues.push({
      id: issueId(detected.path, "key-whitespace"),
      kind: "key-whitespace",
      severity: "minor",
      table: detected.path,
      count: whitespaceRows.length,
      samples: sampleKeys(whitespaceRows.map((row) => row.rawKey)),
      anchors: uniqAnchors([
        header,
        ...whitespaceRows
          .slice(0, MAX_WITNESSES)
          .map((row) => rowAnchor(detected, row.row, row.key)),
      ]),
    });
  }

  const emptySourceRows = keys.filter((row) => cellText(row.row, detected.sourceIndex) === "");
  if (emptySourceRows.length > 0) {
    issues.push({
      id: issueId(detected.path, "empty-source"),
      kind: "empty-source",
      severity: "major",
      table: detected.path,
      column: detected.sourceColumn,
      count: emptySourceRows.length,
      samples: sampleKeys(emptySourceRows.map((row) => row.key)),
      anchors: uniqAnchors([
        header,
        ...emptySourceRows
          .slice(0, MAX_WITNESSES)
          .map((row) =>
            cellAnchor(detected, row.row, detected.sourceIndex, row.key, detected.sourceColumn),
          )
          .filter((anchor): anchor is LocalizationAnchorRef => anchor !== undefined),
      ]),
    });
  }

  let emptyTranslationCount = 0;
  for (const language of detected.languages) {
    if (language.index === detected.sourceIndex) continue;
    const emptyRows = keys.filter(
      (row) =>
        cellText(row.row, language.index) === "" && cellText(row.row, detected.sourceIndex) !== "",
    );
    emptyTranslationCount += emptyRows.length;
    if (emptyRows.length === 0) continue;
    issues.push({
      id: issueId(detected.path, `empty-translation|${language.column}`),
      kind: "empty-translation",
      severity: "minor",
      table: detected.path,
      column: language.column,
      count: emptyRows.length,
      samples: sampleKeys(emptyRows.map((row) => row.key)),
      anchors: uniqAnchors([
        header,
        ...emptyRows
          .slice(0, MAX_WITNESSES)
          .map((row) => cellAnchor(detected, row.row, language.index, row.key, language.column))
          .filter((anchor): anchor is LocalizationAnchorRef => anchor !== undefined),
      ]),
    });
  }

  let placeholderMismatchCount = 0;
  for (const language of detected.languages) {
    if (language.index === detected.sourceIndex) continue;
    let mismatchCount = 0;
    const samples: string[] = [];
    const anchors: LocalizationAnchorRef[] = [header];
    for (const row of keys) {
      const sourceText = row.row.cells[detected.sourceIndex]?.text ?? "";
      const targetText = row.row.cells[language.index]?.text ?? "";
      if (sourceText.trim() === "" || targetText.trim() === "") continue;
      if (samePlaceholders(sourceText, targetText)) continue;
      mismatchCount += 1;
      if (samples.length < MAX_SAMPLES) samples.push(row.key);
      const sourceAnchor = cellAnchor(
        detected,
        row.row,
        detected.sourceIndex,
        row.key,
        detected.sourceColumn,
      );
      const targetAnchor = cellAnchor(detected, row.row, language.index, row.key, language.column);
      if (sourceAnchor !== undefined) anchors.push(sourceAnchor);
      if (targetAnchor !== undefined) anchors.push(targetAnchor);
      if (anchors.length >= 1 + MAX_WITNESSES * 2) break;
    }
    placeholderMismatchCount += mismatchCount;
    if (mismatchCount === 0) continue;
    issues.push({
      id: issueId(detected.path, `placeholder|${language.column}`),
      kind: "placeholder-mismatch",
      severity: "major",
      table: detected.path,
      column: language.column,
      count: mismatchCount,
      samples,
      anchors: uniqAnchors(anchors),
    });
  }

  let addedKeys: string[] = [];
  let removedKeys: string[] = [];
  let status: LocalizationTableStatus = "added";
  if (base !== undefined) {
    const currentKeys = keySet(rows);
    const baseKeys = keySet(keyRows(base.detected).rows);
    addedKeys = [...currentKeys].filter((key) => !baseKeys.has(key));
    removedKeys = [...baseKeys].filter((key) => !currentKeys.has(key));
    status = base.source === detected.source ? "unchanged" : "changed";
  }

  if (addedKeys.length > 0) {
    const anchors: LocalizationAnchorRef[] = [header];
    for (const key of addedKeys.slice(0, MAX_WITNESSES)) {
      const row = byKey.get(key);
      if (row !== undefined) anchors.push(rowAnchor(detected, row.row, key));
    }
    issues.push({
      id: issueId(detected.path, "key-added"),
      kind: "key-added",
      severity: "info",
      table: detected.path,
      count: addedKeys.length,
      samples: sampleKeys(addedKeys),
      anchors: uniqAnchors(anchors),
    });
  }

  if (removedKeys.length > 0 && base !== undefined) {
    const anchors: LocalizationAnchorRef[] = [];
    const baseRows = keyRows(base.detected).rows;
    const baseByKey = new Map(baseRows.map((row) => [row.key, row]));
    for (const key of removedKeys.slice(0, MAX_WITNESSES)) {
      const row = baseByKey.get(key);
      if (row !== undefined) {
        anchors.push(rowAnchor(base.detected, row.row, key, "A"));
      }
    }
    issues.push({
      id: issueId(detected.path, "key-removed"),
      kind: "key-removed",
      severity: "major",
      table: detected.path,
      count: removedKeys.length,
      samples: sampleKeys(removedKeys),
      anchors: uniqAnchors(anchors),
    });
  }

  return {
    path: detected.path,
    status,
    sourceColumn: detected.sourceColumn,
    keyCount: keys.length,
    languageCount: detected.languages.length,
    metadataRowsSkipped,
    duplicateKeyCount: duplicates.length,
    emptyKeyCount: emptyKeyRows.length,
    whitespaceKeyCount: whitespaceRows.length,
    emptySourceCount: emptySourceRows.length,
    emptyTranslationCount,
    placeholderMismatchCount,
    addedKeyCount: addedKeys.length,
    removedKeyCount: removedKeys.length,
    coverage: coverageFor(detected, keys),
    issues,
  };
}

function parseTables(
  sources: readonly SourceInput[],
): Map<string, { source: string; table: CsvTable }> {
  const tables = new Map<string, { source: string; table: CsvTable }>();
  for (const input of sources) {
    if (!TABLE_EXTENSION.test(input.path)) continue;
    tables.set(input.path, {
      source: input.source,
      table: parseCsv(input.source, delimiterForPath(input.path)),
    });
  }
  return tables;
}

function detectedTables(sources: readonly SourceInput[]): Map<string, DetectedLocalizationTable> {
  const out = new Map<string, DetectedLocalizationTable>();
  for (const [path, entry] of parseTables(sources)) {
    const detected = detectLocalizationTable(path, entry.source, entry.table);
    if (detected !== undefined) out.set(path, detected);
  }
  return out;
}

function toAnchor(
  anchor: LocalizationAnchorRef,
  sources: ReadonlyMap<"A" | "B", ReadonlyMap<string, string>>,
): Anchor | undefined {
  const source = sources.get(anchor.ref)?.get(anchor.file);
  if (source === undefined) return undefined;
  const parts = [
    anchor.ref,
    anchor.file,
    String(anchor.span.line),
    String(anchor.span.endLine),
    "csv",
  ];
  if (anchor.loc?.rowKey !== undefined) parts.push(`r:${anchor.loc.rowKey}`);
  if (anchor.loc?.column !== undefined) parts.push(`c:${String(anchor.loc.column)}`);
  const id = parts.join(":");
  return {
    id,
    ref: anchor.ref,
    file: anchor.file,
    blobSha: gitBlobSha(source),
    lineStart: anchor.span.line,
    lineEnd: anchor.span.endLine,
    snippet: source.slice(anchor.span.offset, anchor.span.offset + anchor.span.length),
    kind: "csv",
    ...(anchor.loc === undefined ? {} : { loc: anchor.loc }),
  };
}

/**
 * Build the full localization report for an A/B range. Pure: same sources and refs yield
 * byte-identical JSON; no clock, git, or network reads.
 */
export function buildLocalizationReport(input: {
  readonly base: LocalizationSideInput;
  readonly current: LocalizationSideInput;
}): LocalizationReport {
  const baseSources = new Map(input.base.sources.map((source) => [source.path, source.source]));
  const currentSources = new Map(
    input.current.sources.map((source) => [source.path, source.source]),
  );
  const anchorsByRef = new Map<"A" | "B", ReadonlyMap<string, string>>([
    ["A", baseSources],
    ["B", currentSources],
  ]);
  const baseTables = detectedTables(input.base.sources);
  const currentTables = detectedTables(input.current.sources);
  const tables: LocalizationTableReport[] = [];

  for (const [path, detected] of currentTables) {
    const baseDetected = baseTables.get(path);
    const baseEntry =
      baseDetected === undefined
        ? undefined
        : {
            source: baseDetected.source,
            table: baseDetected.table,
            detected: baseDetected,
          };
    const analysis = analyzeLocalizationTable(detected, baseEntry);
    const issues = analysis.issues.flatMap((issue) => {
      const anchors = issue.anchors
        .map((anchor) => toAnchor(anchor, anchorsByRef))
        .filter((anchor): anchor is Anchor => anchor !== undefined);
      return [
        {
          id: issue.id,
          ruleId: "LOC-01" as const,
          kind: issue.kind,
          severity: issue.severity,
          confidence: "exact" as const,
          table: issue.table,
          ...(issue.key === undefined ? {} : { key: issue.key }),
          ...(issue.column === undefined ? {} : { column: issue.column }),
          count: issue.count,
          samples: [...issue.samples],
          anchors,
        },
      ];
    });
    tables.push({ ...analysis, coverage: [...analysis.coverage], issues });
  }

  for (const [path, detected] of baseTables) {
    if (currentTables.has(path)) continue;
    const rows = keyRows(detected).rows.filter((row) => row.key !== "");
    tables.push({
      path,
      status: "removed",
      sourceColumn: detected.sourceColumn,
      keyCount: rows.length,
      languageCount: detected.languages.length,
      metadataRowsSkipped: keyRows(detected).metadataRowsSkipped,
      duplicateKeyCount: 0,
      emptyKeyCount: 0,
      whitespaceKeyCount: 0,
      emptySourceCount: 0,
      emptyTranslationCount: 0,
      placeholderMismatchCount: 0,
      addedKeyCount: 0,
      removedKeyCount: 0,
      coverage: [],
      issues: [],
    });
  }

  tables.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const totals = {
    tables: tables.length,
    keys: tables.reduce((sum, table) => sum + table.keyCount, 0),
    duplicateKeys: tables.reduce((sum, table) => sum + table.duplicateKeyCount, 0),
    emptyTranslations: tables.reduce((sum, table) => sum + table.emptyTranslationCount, 0),
    placeholderMismatches: tables.reduce((sum, table) => sum + table.placeholderMismatchCount, 0),
    addedKeys: tables.reduce((sum, table) => sum + table.addedKeyCount, 0),
    removedKeys: tables.reduce((sum, table) => sum + table.removedKeyCount, 0),
  };

  return {
    schemaVersion: LOCALIZATION_SCHEMA_VERSION,
    refs: { base: input.base.label, current: input.current.label },
    tables,
    totals,
    note:
      tables.length === 0
        ? "No *key.csv localization table was detected on the current side."
        : "Detected *key.csv tables from their language header; the LanguageKey metadata row is skipped when present. Counts are exact observations; runtime effects are not asserted.",
  };
}

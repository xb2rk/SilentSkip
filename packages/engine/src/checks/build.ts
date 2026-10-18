/**
 * Built-in checks (E7.1 baseline + E7.3 checks full): pure functions over `CheckInput`.
 *
 * Shipped rules:
 * - `STRUCT-01` — row width differs from the header cell count, per table per side. The loader
 *   guard is a comparison against a column-count constant; this check reports the raw structure
 *   the guard would skip rows on. Nothing is inferred about what the "right" width is.
 * - `STRUCT-02` — row keys (PK) duplicated or empty, per table per side. The key column comes
 *   from a profile pin (`pin-row-key` override → exact) or falls back to the first column
 *   (documented inferred convention — the message suggests pinning). Last-wins loaders silently
 *   overwrite earlier rows, hence severity `major`.
 * - `STRUCT-03` — header hygiene: empty/whitespace/duplicate/unicode header names. Information
 *   only: loaders that bind columns by header name can mis-bind, but nothing is broken per se.
 * - `TYPE-01` — declared type row vs real values: a value that would fail the declared type
 *   (parse-fail defaulting, `minor`) and leading-zero integers (lossy format, `info`). The type
 *   row is detected by the format vocabulary (every non-empty cell of row 1 is an FC type name).
 * - `BIND-03` — candidate binding: an enum whose members cover every header column of a changed
 *   table (exact text match, index-enum shape). A candidate only — confidence `inferred` unless
 *   the profile pins this table to that enum, then `exact`.
 * - `BIND-04` — a changed table that no current code references: no `.csv` string literal and no
 *   header-matching enum. The absence is an exact fact; the runtime use stays unknown (info).
 * - `DANGLING-REF` — a symbol removed in B still has same-name references in B that resolve
 *   nowhere, while the A-side references resolved exactly to the removed symbol.
 * - `CALL-ARITY-01` — a call whose argument count differs from the resolved declaration's
 *   parameter count. Receiver-aware: member calls resolve through the receiver (import alias,
 *   or a graph container across the whole bundle); unresolvable or ambiguous receivers stay
 *   silent — an honest skip, never a name-only guess. Current side.
 * - `ORPHAN-ADD-01` — a function added in B whose name appears in no reference, call or import
 *   anywhere in the current codebase. The absence of references is exact; the interpretation
 *   ("dead code unless invoked dynamically") is what the message offers.
 *
 * Severity/confidence semantics follow spec §4.7 + decision #28: `exact` means every derivation
 * step is a recorded fact; `inferred` findings stay soft (severity is kept, but the message says
 * what to pin to make them exact).
 */

import {
  cellSpan,
  columnLabel,
  detectTypeRow,
  failsDeclaredType,
  isBlankRow,
  resolveRowKey,
  rowKeyDisplay,
  rowKeyIsEmpty,
  rowKeyLabels,
  rowKeyValue,
  rowSpan,
} from "../csv/analysis.js";
import type { CsvCell, CsvRow, CsvTable } from "../csv/index.js";
import { type CallFact, type FileFacts, resolveName, type SymbolFact } from "../facts/index.js";
import { checkForeignKeys } from "./references.js";
import type { CheckFinding, CheckInput, CheckSide, RegisterAnchor } from "./types.js";

/** Maximum mismatching-row witnesses attached to one STRUCT-01 finding. */
const MAX_WIDTH_WITNESSES = 10;

/** Maximum reference witnesses per side attached to one DANGLING-REF finding. */
const MAX_REF_WITNESSES = 5;

/** Maximum row witnesses attached to one STRUCT-02 finding. */
const MAX_KEY_WITNESSES = 8;

/** Maximum cell witnesses attached to one STRUCT-03 / TYPE-01 finding. */
const MAX_CELL_WITNESSES = 8;

/** Maximum position witnesses attached to one DRIFT-01 finding. */
const MAX_DRIFT_WITNESSES = 6;

/** The FC type vocabulary that may appear in a CSV type row - the format axiom. */
/** Non-ASCII range check for header hygiene. */
const NON_ASCII_PATTERN = /[^\x20-\x7E]/u;

/** Runs every shipped check and returns findings sorted by id. */
export function runChecks(input: CheckInput): CheckFinding[] {
  const findings = [
    ...checkTableWidths(input),
    ...checkRowKeys(input),
    ...checkHeaderHygiene(input),
    ...checkHeaderDrift(input),
    ...checkTypeRows(input),
    ...checkBindings(input),
    ...checkForeignKeys(input),
    ...checkDanglingReferences(input),
    ...checkCallArity(input),
    ...checkOrphanAdditions(input),
  ];
  return findings.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * CALL-ARITY-01 — a call whose argument count differs from the resolved declaration's parameter
 * count (a refactor left a call site behind). Severity `major`: at runtime this call breaks.
 *
 * Resolution is receiver-aware. A member call (`X.Method(...)`) never resolves by bare name —
 * `InventoryStore.InitializePlayer(a, b)` must not match an unrelated same-file `InitializePlayer`.
 * Receiver candidates, in order: an import alias of the calling file (the imported file's
 * functions), then every identifier of the receiver expression, last token first
 * (`e<ServerSvc>` → `ServerSvc`), each resolved as a unique graph container across the whole
 * bundle. Unresolvable, ambiguous or invisible targets stay silent. Bare calls keep the
 * same-file name ladder; import-level bare resolutions are skipped.
 */
function checkCallArity(input: CheckInput): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const containerIndex = buildContainerIndex(input.current.factsByPath);
  const bundlePaths = [...input.current.factsByPath.keys()];
  for (const file of input.current.factsByPath.values()) {
    for (const call of file.calls) {
      if (call.calleeName === undefined) continue;
      const target =
        call.receiverText === undefined
          ? resolveBareTarget(call, file)
          : resolveMemberTarget(input, call, file, containerIndex, bundlePaths);
      if (target === undefined) continue;
      const { symbol, symbolFile } = target;
      if (symbol.paramCount === call.argumentCount) continue;
      findings.push({
        id: `CALL-ARITY-01|B|${file.path}|${call.span.offset}`,
        ruleId: "CALL-ARITY-01",
        severity: "major",
        confidence: "exact",
        title: "Call arity differs from the declaration",
        message: `\`${call.calleeText}\` passes ${call.argumentCount} argument(s) but \`${symbol.name}\` declares ${symbol.paramCount} parameter(s) in ${symbolFile} (side B). A signature change may have left this call site unmodified.`,
        anchors: [
          input.registerAnchor("B", file.path, call.span, "code"),
          input.registerAnchor("B", symbolFile, symbol.nameSpan, "code"),
        ],
        derivation: [
          `The callee \`${call.calleeName}\` resolves exactly to the function \`${symbol.name}\` (${symbol.paramCount} parameter(s)) in ${symbolFile}.`,
          `The call site passes ${call.argumentCount} argument(s) — raw syntax, nothing inferred.`,
          "Both spans are anchored on side B (the current state).",
        ],
      });
    }
  }
  return findings;
}

/** A target function with the file that declares it (may differ from the call site's file). */
interface CallTarget {
  readonly symbol: SymbolFact;
  readonly symbolFile: string;
}

/** Bare calls keep the same-file name ladder; import-level resolutions are skipped. */
function resolveBareTarget(call: CallFact, file: FileFacts): CallTarget | undefined {
  const resolution = resolveName(call.calleeName ?? "", call.container, file.symbols, file.imports);
  if (resolution.status !== "resolved" || resolution.level === "import") return undefined;
  const symbol = file.symbols.find((candidate) => candidate.id === resolution.resolvedId);
  if (symbol === undefined || symbol.kind !== "function" || symbol.paramCount === undefined) {
    return undefined;
  }
  return { symbol, symbolFile: file.path };
}

/** Member calls resolve through the receiver: import alias first, then container candidates. */
function resolveMemberTarget(
  input: CheckInput,
  call: CallFact,
  file: FileFacts,
  containerIndex: ReadonlyMap<string, readonly ContainerEntry[]>,
  bundlePaths: readonly string[],
): CallTarget | undefined {
  const receiverText = call.receiverText;
  if (receiverText === undefined || call.calleeName === undefined) return undefined;

  const receiverName = /^[A-Za-z_][A-Za-z0-9_]*$/.test(receiverText) ? receiverText : undefined;
  if (receiverName !== undefined) {
    const importFact = file.imports.find(
      (imp) => imp.alias === receiverName || imp.imported === receiverName,
    );
    if (importFact !== undefined) {
      // The receiver names an import: the imported file's functions are the only candidates.
      const targetFile = resolveImportFile(importFact.path, file.path, bundlePaths);
      const facts =
        targetFile === undefined ? undefined : input.current.factsByPath.get(targetFile);
      if (facts === undefined) return undefined;
      return uniqueMember(facts, undefined, call.calleeName);
    }
  }

  for (const candidate of receiverCandidates(receiverText)) {
    const entries = containerIndex.get(candidate);
    if (entries === undefined || entries.length !== 1) continue;
    const entry = entries[0];
    if (entry === undefined) continue;
    const facts = input.current.factsByPath.get(entry.file);
    if (facts === undefined) continue;
    const target = uniqueMember(facts, entry.name, call.calleeName);
    if (target !== undefined) return target;
  }
  return undefined;
}

/** A graph/declare-graph container that can own member functions, indexed by name. */
interface ContainerEntry {
  readonly file: string;
  readonly name: string;
}

function buildContainerIndex(files: ReadonlyMap<string, FileFacts>): Map<string, ContainerEntry[]> {
  const index = new Map<string, ContainerEntry[]>();
  for (const file of files.values()) {
    for (const symbol of file.symbols) {
      if (symbol.kind !== "graph" && symbol.kind !== "declare-graph") continue;
      const entries = index.get(symbol.name) ?? [];
      entries.push({ file: file.path, name: symbol.name });
      index.set(symbol.name, entries);
    }
  }
  return index;
}

/** Identifier tokens of a receiver expression, last token first — `e<Svc>` → [Svc, e]. */
function receiverCandidates(receiverText: string): string[] {
  const tokens = receiverText.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  return [...new Set(tokens)].reverse();
}

/** Exactly-one member function in a file (optionally inside one container), else silent. */
function uniqueMember(
  facts: FileFacts,
  container: string | undefined,
  name: string,
): CallTarget | undefined {
  const matches = facts.symbols.filter(
    (symbol) =>
      symbol.kind === "function" &&
      symbol.name === name &&
      symbol.paramCount !== undefined &&
      (container === undefined || symbol.container === container),
  );
  if (matches.length !== 1) return undefined;
  const symbol = matches[0];
  if (symbol === undefined) return undefined;
  return { symbol, symbolFile: facts.path };
}

/** Resolve a relative import path to a bundle path (relative first, then a unique suffix). */
function resolveImportFile(
  importPath: string,
  importer: string,
  bundlePaths: readonly string[],
): string | undefined {
  const normalized = importPath.split("\\").join("/");
  const dir = importer.includes("/") ? importer.slice(0, importer.lastIndexOf("/")) : "";
  const combined = collapseSegments(dir === "" ? normalized : `${dir}/${normalized}`);
  if (combined !== undefined && bundlePaths.includes(combined)) return combined;
  const needle = normalized.toLowerCase();
  const suffixMatches = bundlePaths.filter((path) => {
    const lower = path.toLowerCase();
    return lower === needle || lower.endsWith(`/${needle}`);
  });
  return suffixMatches.length === 1 ? suffixMatches[0] : undefined;
}

/** Collapse `.`/`..` path segments; undefined when the path escapes its root. */
function collapseSegments(path: string): string | undefined {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return undefined;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

/**
 * ORPHAN-ADD-01 — a function added in B whose name appears in no reference, call or import
 * anywhere in the whole current codebase. The absence is exact (full-scope scan); whether it
 * is dead code or framework-invoked dynamically is not — hence `info` and the note/pin hint.
 * Events are excluded: framework lifecycles can invoke them implicitly by convention.
 */
function checkOrphanAdditions(input: CheckInput): CheckFinding[] {
  const referencedNames = new Set<string>();
  for (const file of input.current.factsByPath.values()) {
    for (const ref of file.refs) referencedNames.add(ref.name);
    for (const call of file.calls) {
      if (call.calleeName !== undefined) referencedNames.add(call.calleeName);
    }
    for (const imp of file.imports) {
      if (imp.imported !== undefined) referencedNames.add(imp.imported);
    }
  }
  const findings: CheckFinding[] = [];
  for (const script of input.delta.scripts) {
    if (script.status !== "added" && script.status !== "changed") continue;
    if (input.current.factsByPath.get(script.path) === undefined) continue;
    for (const symbol of script.symbolsAdded) {
      if (symbol.scope === "local") continue;
      if (symbol.kind !== "function") continue;
      if (referencedNames.has(symbol.name)) continue;
      findings.push({
        id: `ORPHAN-ADD-01|B|${script.path}|${symbol.id}`,
        ruleId: "ORPHAN-ADD-01",
        severity: "info",
        confidence: "exact",
        title: "Added symbol has no references in the current codebase",
        message: `\`${symbol.name}\` was added to ${script.path} but no reference, call or import name in the whole current codebase mentions it. If the framework invokes it dynamically, record that as a note/pin; otherwise it is dead code.`,
        anchors: [input.registerAnchor("B", script.path, symbol.nameSpan, "code")],
        derivation: [
          `Every current file's references, call callees and import names were scanned for \`${symbol.name}\` — zero hits.`,
          "The absence is exact (full-scope scan); why it is unreferenced is not.",
        ],
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------------------------
// STRUCT-01 — row width differs from the header
// ---------------------------------------------------------------------------------------------

/** Row-width analysis of one table side. */
interface WidthAnalysis {
  readonly headerColumns: number;
  readonly dataRows: number;
  readonly mismatched: readonly CsvRow[];
}

function analyzeWidths(table: CsvTable): WidthAnalysis {
  const header = table.rows[0];
  const headerColumns = header === undefined ? 0 : header.cells.length;
  let dataRows = 0;
  const mismatched: CsvRow[] = [];
  for (const row of table.rows) {
    if (row.index === 0) continue;
    dataRows += 1;
    if (row.cells.length !== headerColumns) mismatched.push(row);
  }
  return { headerColumns, dataRows, mismatched };
}

function widthFindingForSide(
  input: CheckInput,
  path: string,
  ref: "A" | "B",
  present: boolean,
): CheckFinding[] {
  if (!present) return [];
  const side: CheckSide = ref === "A" ? input.base : input.current;
  const table = side.tables.get(path);
  if (table === undefined) return [];
  const analysis = analyzeWidths(table);
  if (analysis.mismatched.length === 0) return [];
  const header = table.rows[0];
  const register: RegisterAnchor = input.registerAnchor;
  const anchors: string[] = [];
  if (header !== undefined) anchors.push(register(ref, path, rowSpan(header), "csv"));
  for (const row of analysis.mismatched.slice(0, MAX_WIDTH_WITNESSES)) {
    anchors.push(register(ref, path, rowSpan(row), "csv"));
  }
  const witnessCount = Math.min(analysis.mismatched.length, MAX_WIDTH_WITNESSES);
  return [
    {
      id: `STRUCT-01|${ref}|${path}`,
      ruleId: "STRUCT-01",
      severity: "major",
      confidence: "exact",
      title: "Row width differs from the header",
      message:
        `${analysis.mismatched.length} of ${analysis.dataRows} data rows in ${path} ` +
        `(side ${ref}) have a width different from the header (${analysis.headerColumns} columns). ` +
        `Loaders that guard on the column count skip such rows.`,
      anchors,
      derivation: [
        `Header cell count on side ${ref}: ${analysis.headerColumns}.`,
        "Every data row width compared against the header — raw CSV structure, nothing inferred.",
        `Witness anchors: header row plus the first ${witnessCount} mismatching row(s).`,
      ],
    },
  ];
}

function checkTableWidths(input: CheckInput): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const delta of input.delta.tables) {
    findings.push(...widthFindingForSide(input, delta.path, "A", delta.status !== "added"));
    findings.push(...widthFindingForSide(input, delta.path, "B", delta.status !== "removed"));
  }
  return findings;
}

// ---------------------------------------------------------------------------------------------
// STRUCT-02 — row keys duplicated or empty
// ---------------------------------------------------------------------------------------------

function rowKeyFindingForSide(
  input: CheckInput,
  path: string,
  ref: "A" | "B",
  present: boolean,
): CheckFinding[] {
  if (!present) return [];
  const side: CheckSide = ref === "A" ? input.base : input.current;
  const table = side.tables.get(path);
  if (table === undefined) return [];
  const resolution = resolveRowKey(table, path, input.profile);
  if (resolution === undefined) return [];
  const header = table.rows[0];

  if (resolution.kind === "pin-missing") {
    const anchors: string[] = [];
    if (header !== undefined) anchors.push(input.registerAnchor(ref, path, rowSpan(header), "csv"));
    const wanted = resolution.columns.map((name) => `"${name}"`).join(", ");
    return [
      {
        id: `STRUCT-02|${ref}|${path}|pin`,
        ruleId: "STRUCT-02",
        severity: "major",
        confidence: "exact",
        title: "Pinned row-key column is not in the header",
        message:
          `The project profile pins the row key of ${path} to column(s) ${wanted}, ` +
          `but the header on side ${ref} has no such column. The pinned convention cannot apply.`,
        anchors,
        derivation: [
          `Profile override (pin-row-key) for ${path}: key column(s) ${wanted}.`,
          `Header cells on side ${ref}: ${(header?.cells ?? []).map((cell) => cell.text.trim()).join(", ")}.`,
          "Exact text comparison — at least one pinned column was not found.",
        ],
      },
    ];
  }

  const typeRow = detectTypeRow(table);
  const rows = table.rows.filter((row) => row.index !== 0 && row !== typeRow && !isBlankRow(row));
  const empty: CsvRow[] = [];
  const duplicates: { row: CsvRow; key: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const value = rowKeyValue(row, resolution.columns);
    if (rowKeyIsEmpty(value)) {
      empty.push(row);
      continue;
    }
    if (seen.has(value)) duplicates.push({ row, key: rowKeyDisplay(value) });
    else seen.add(value);
  }
  if (empty.length === 0 && duplicates.length === 0) return [];

  const anchors: string[] = [];
  if (header !== undefined) anchors.push(input.registerAnchor(ref, path, rowSpan(header), "csv"));
  const witnessRows = [...duplicates.map((duplicate) => duplicate.row), ...empty].slice(
    0,
    MAX_KEY_WITNESSES,
  );
  for (const row of witnessRows) {
    anchors.push(input.registerAnchor(ref, path, rowSpan(row), "csv"));
  }
  const parts: string[] = [];
  if (duplicates.length > 0) parts.push(`${duplicates.length} duplicate row key(s)`);
  if (empty.length > 0) parts.push(`${empty.length} empty row key(s)`);
  const keyLabel = rowKeyLabels(table, resolution.columns);
  return [
    {
      id: `STRUCT-02|${ref}|${path}`,
      ruleId: "STRUCT-02",
      severity: "major",
      confidence: resolution.exact ? "exact" : "inferred",
      title: "Row keys are duplicated or empty",
      message:
        `${parts.join(" and ")} among ${rows.length} data rows in ${path} ` +
        `(side ${ref}, key column "${keyLabel}"). Last-wins loaders silently overwrite earlier rows.` +
        (resolution.exact
          ? ""
          : " The key column is inferred (first column) — pin the row-key column to make this finding exact."),
      anchors,
      derivation: [
        resolution.note,
        "Every data row's trimmed key text compared — raw table data, nothing inferred.",
        `Witness anchors: header row plus the first ${witnessRows.length} offending row(s).`,
      ],
    },
  ];
}

function checkRowKeys(input: CheckInput): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const delta of input.delta.tables) {
    findings.push(...rowKeyFindingForSide(input, delta.path, "A", delta.status !== "added"));
    findings.push(...rowKeyFindingForSide(input, delta.path, "B", delta.status !== "removed"));
  }
  return findings;
}

// ---------------------------------------------------------------------------------------------
// STRUCT-03 — header hygiene
// ---------------------------------------------------------------------------------------------

function hygieneFindingForSide(
  input: CheckInput,
  path: string,
  ref: "A" | "B",
  present: boolean,
): CheckFinding[] {
  if (!present) return [];
  const side: CheckSide = ref === "A" ? input.base : input.current;
  const table = side.tables.get(path);
  if (table === undefined) return [];
  const header = table.rows[0];
  if (header === undefined) return [];

  const emptyIndexes: number[] = [];
  const duplicateIndexes: number[] = [];
  const whitespaceIndexes: number[] = [];
  const unicodeIndexes: number[] = [];
  const seen = new Set<string>();
  header.cells.forEach((cell, index) => {
    const text = cell.text;
    const trimmed = text.trim();
    if (trimmed === "") {
      emptyIndexes.push(index);
      return;
    }
    if (text !== trimmed) whitespaceIndexes.push(index);
    if (seen.has(trimmed)) duplicateIndexes.push(index);
    else seen.add(trimmed);
    if (NON_ASCII_PATTERN.test(text)) unicodeIndexes.push(index);
  });
  if (
    emptyIndexes.length === 0 &&
    duplicateIndexes.length === 0 &&
    whitespaceIndexes.length === 0 &&
    unicodeIndexes.length === 0
  ) {
    return [];
  }

  const anchors: string[] = [input.registerAnchor(ref, path, rowSpan(header), "csv")];
  const witnessIndexes = [
    ...emptyIndexes,
    ...duplicateIndexes,
    ...whitespaceIndexes,
    ...unicodeIndexes,
  ].slice(0, MAX_CELL_WITNESSES);
  for (const index of witnessIndexes) {
    const cell = header.cells[index];
    if (cell !== undefined) anchors.push(input.registerAnchor(ref, path, cellSpan(cell), "csv"));
  }
  const parts: string[] = [];
  if (duplicateIndexes.length > 0) parts.push(`${duplicateIndexes.length} duplicate name(s)`);
  if (emptyIndexes.length > 0) parts.push(`${emptyIndexes.length} empty cell(s)`);
  if (whitespaceIndexes.length > 0)
    parts.push(`${whitespaceIndexes.length} name(s) with surrounding whitespace`);
  if (unicodeIndexes.length > 0) parts.push(`${unicodeIndexes.length} non-ASCII name(s)`);
  return [
    {
      id: `STRUCT-03|${ref}|${path}`,
      ruleId: "STRUCT-03",
      severity: "info",
      confidence: "exact",
      title: "Header hygiene issues",
      message:
        `Header row of ${path} (side ${ref}) has ${parts.join(", ")}. ` +
        `Loaders that bind columns by header name can mis-bind on these.`,
      anchors,
      derivation: [
        `Header cells on side ${ref}: ${header.cells.length}.`,
        "Each header cell checked for emptiness, trimmed duplicates, surrounding whitespace and non-ASCII characters — raw text comparison.",
        `Witness anchors: header row plus the first ${witnessIndexes.length} offending cell(s).`,
      ],
    },
  ];
}

function checkHeaderHygiene(input: CheckInput): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const delta of input.delta.tables) {
    findings.push(...hygieneFindingForSide(input, delta.path, "A", delta.status !== "added"));
    findings.push(...hygieneFindingForSide(input, delta.path, "B", delta.status !== "removed"));
  }
  return findings;
}

// ---------------------------------------------------------------------------------------------
// DRIFT-01 — A/B header drift (rename or reorder at the same column count)
// ---------------------------------------------------------------------------------------------

/**
 * DRIFT-01 — the header row changed between A and B while the column count stayed the same.
 *
 * A rename or reorder is the worst silent case for readers that address columns by position:
 * the ordinal still exists, so nothing throws, but it now points at a different field
 * (`wrong_column`). Name-based readers are equally exposed to a rename. Only structural facts
 * are asserted: the before/after header cells. Whether any reader is positional is not known,
 * so the message says "readers that ..." rather than claiming a runtime failure.
 */
function checkHeaderDrift(input: CheckInput): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const delta of input.delta.tables) {
    if (!delta.headerChanged || delta.status !== "changed") continue;
    const beforeTable = input.base.tables.get(delta.path);
    const afterTable = input.current.tables.get(delta.path);
    if (beforeTable === undefined || afterTable === undefined) continue;
    const beforeHeader = beforeTable.rows[0];
    const afterHeader = afterTable.rows[0];
    if (beforeHeader === undefined || afterHeader === undefined) continue;
    const before = beforeHeader.cells.map((cell) => cell.text.trim());
    const after = afterHeader.cells.map((cell) => cell.text.trim());
    if (before.length !== after.length || before.length < 2) continue;

    const changed: { index: number; before: string; after: string }[] = [];
    for (const [index, name] of before.entries()) {
      const next = after[index];
      if (next !== undefined && next !== name) changed.push({ index, before: name, after: next });
    }
    if (changed.length === 0) continue;

    const sameSet = [...before].sort().join("\u0000") === [...after].sort().join("\u0000");
    const kind = sameSet ? "reordered" : "renamed";
    const anchors: string[] = [
      input.registerAnchor("A", delta.path, rowSpan(beforeHeader), "csv"),
      input.registerAnchor("B", delta.path, rowSpan(afterHeader), "csv"),
    ];
    for (const change of changed.slice(0, MAX_DRIFT_WITNESSES)) {
      const oldCell = beforeHeader.cells[change.index];
      const newCell = afterHeader.cells[change.index];
      if (oldCell !== undefined) {
        anchors.push(input.registerAnchor("A", delta.path, cellSpan(oldCell), "csv"));
      }
      if (newCell !== undefined) {
        anchors.push(input.registerAnchor("B", delta.path, cellSpan(newCell), "csv"));
      }
    }
    const witnesses = changed
      .slice(0, 4)
      .map((change) => `#${change.index} "${change.before}" → "${change.after}"`)
      .join(", ");
    findings.push({
      id: `DRIFT-01|B|${delta.path}`,
      ruleId: "DRIFT-01",
      severity: "critical",
      confidence: "exact",
      title: "A/B column drift",
      message:
        `Header row of ${delta.path} was ${kind} between A and B at the same column count ` +
        `(${before.length} columns): ${witnesses}${changed.length > 4 ? `, +${changed.length - 4} more` : ""}. ` +
        `Readers that address columns by position now read a different field; name-based readers ` +
        `also miss renamed columns. Nothing throws at runtime - the value is simply wrong.`,
      anchors,
      derivation: [
        `Column count is equal on both sides: ${before.length}.`,
        `Header names compared by trimmed text at each 0-based position; ${changed.length} position(s) differ.`,
        `Name set is ${sameSet ? "identical → reorder" : "different → rename"}.`,
        "Whether any reader is positional is not known from CSV alone; the severity reflects the wrong_column exposure from the spec.",
      ],
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------------------------
// TYPE-01 — declared type row vs real values
// ---------------------------------------------------------------------------------------------

const LEADING_ZERO_PATTERN = /^-?0\d+/u;

interface TypeWitness {
  readonly row: CsvRow;
  readonly cell: CsvCell;
  readonly declared: string;
  readonly value: string;
}

function typeFindingForSide(
  input: CheckInput,
  path: string,
  ref: "A" | "B",
  present: boolean,
): CheckFinding[] {
  if (!present) return [];
  const side: CheckSide = ref === "A" ? input.base : input.current;
  const table = side.tables.get(path);
  if (table === undefined) return [];
  const typeRow = detectTypeRow(table);
  if (typeRow === undefined) return [];
  const declared = typeRow.cells.map((cell) => cell.text.trim().toLowerCase());

  const mismatches: TypeWitness[] = [];
  const leadingZeros: TypeWitness[] = [];
  for (const row of table.rows) {
    if (row.index <= typeRow.index || isBlankRow(row)) continue;
    for (let index = 0; index < declared.length; index++) {
      const cell = row.cells[index];
      const type = declared[index];
      if (cell === undefined || type === undefined) continue;
      const value = cell.text.trim();
      if (value === "") continue;
      if (failsDeclaredType(type, value)) {
        mismatches.push({ row, cell, declared: type, value });
      } else if ((type === "int" || type === "int64") && LEADING_ZERO_PATTERN.test(value)) {
        leadingZeros.push({ row, cell, declared: type, value });
      }
    }
  }
  if (mismatches.length === 0 && leadingZeros.length === 0) return [];

  const typeRowAnchor = input.registerAnchor(ref, path, rowSpan(typeRow), "csv");
  const findings: CheckFinding[] = [];
  if (mismatches.length > 0) {
    const anchors = [typeRowAnchor];
    for (const witness of mismatches.slice(0, MAX_CELL_WITNESSES)) {
      anchors.push(input.registerAnchor(ref, path, cellSpan(witness.cell), "csv"));
    }
    const sample = mismatches
      .slice(0, 3)
      .map(
        (witness) =>
          `"${witness.value}" (row ${witness.row.line}, column "${columnLabel(table, witness.cell.column)}", declared ${witness.declared})`,
      );
    findings.push({
      id: `TYPE-01|${ref}|${path}`,
      ruleId: "TYPE-01",
      severity: "minor",
      confidence: "exact",
      title: "Values do not match the declared type row",
      message:
        `${mismatches.length} cell(s) in ${path} (side ${ref}) do not match their declared type — ` +
        `e.g. ${sample.join("; ")}. Loaders that parse by the type row fall back to defaults on these.`,
      anchors,
      derivation: [
        `Type row on side ${ref}: ${declared.map((type) => (type === "" ? "-" : type)).join(", ")}.`,
        "Every data cell compared against its declared type with exact text/number checks.",
        `Witness anchors: type row plus the first ${Math.min(mismatches.length, MAX_CELL_WITNESSES)} offending cell(s).`,
      ],
    });
  }
  if (leadingZeros.length > 0) {
    const anchors = [typeRowAnchor];
    for (const witness of leadingZeros.slice(0, MAX_CELL_WITNESSES)) {
      anchors.push(input.registerAnchor(ref, path, cellSpan(witness.cell), "csv"));
    }
    findings.push({
      id: `TYPE-01|${ref}|${path}|leading-zero`,
      ruleId: "TYPE-01",
      severity: "info",
      confidence: "exact",
      title: "Integer values carry leading zeros",
      message:
        `${leadingZeros.length} integer cell(s) in ${path} (side ${ref}) keep leading zeros ` +
        `(e.g. "${leadingZeros[0]?.value ?? ""}"). Parsers that read them as numbers lose the formatting; ` +
        `parsers that read raw text keep it.`,
      anchors,
      derivation: [
        "Declared type is int/int64 for these cells.",
        "Values match ^0\\d+ — the zero prefix is format, not value.",
        `Witness anchors: type row plus the first ${Math.min(leadingZeros.length, MAX_CELL_WITNESSES)} offending cell(s).`,
      ],
    });
  }
  return findings;
}

function checkTypeRows(input: CheckInput): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const delta of input.delta.tables) {
    findings.push(...typeFindingForSide(input, delta.path, "A", delta.status !== "added"));
    findings.push(...typeFindingForSide(input, delta.path, "B", delta.status !== "removed"));
  }
  return findings;
}

// ---------------------------------------------------------------------------------------------
// BIND-03 / BIND-04 — CSV ↔ code binding channels ② / ③
// ---------------------------------------------------------------------------------------------

/** Tolerance for extra enum members beyond header columns (index enums add a Length member). */
const INDEX_ENUM_EXTRA_MEMBERS = 2;

interface BindingCandidate {
  readonly file: string;
  readonly name: string;
  readonly memberCount: number;
}

function findBindingCandidate(
  input: CheckInput,
  headerCells: readonly string[],
): BindingCandidate | undefined {
  const headerSet = new Set(headerCells);
  for (const [file, facts] of input.current.factsByPath) {
    for (const symbol of facts.symbols) {
      if (symbol.kind !== "enum") continue;
      const members = facts.symbols.filter(
        (candidate) => candidate.kind === "enum-member" && candidate.container === symbol.name,
      );
      const memberNames = new Set(members.map((member) => member.name));
      if (memberNames.size < headerSet.size) continue;
      if (memberNames.size > headerSet.size + INDEX_ENUM_EXTRA_MEMBERS) continue;
      let covers = true;
      for (const cell of headerSet) {
        if (!memberNames.has(cell)) {
          covers = false;
          break;
        }
      }
      if (covers) return { file, name: symbol.name, memberCount: memberNames.size };
    }
  }
  return undefined;
}

function bindingFinding(input: CheckInput, path: string): CheckFinding[] {
  const table = input.current.tables.get(path);
  if (table === undefined) return [];
  const header = table.rows[0];
  if (header === undefined) return [];
  const headerCells = header.cells.map((cell) => cell.text.trim()).filter((text) => text !== "");
  if (headerCells.length < 2) return [];

  const boundByLiteral = new Set<string>();
  for (const relation of input.relations?.relations ?? []) {
    if (relation.ruleId === "string-names-csv") boundByLiteral.add(relation.to.file);
  }
  const pinnedTarget = input.profile?.overrides
    .find(
      (override) =>
        override.kind === "pin-binding" &&
        override.target.csvPath === path &&
        override.value !== undefined &&
        override.value.trim() !== "",
    )
    ?.value?.trim();
  if (boundByLiteral.has(path) && pinnedTarget === undefined) return [];

  const candidate = findBindingCandidate(input, headerCells);
  const headerAnchor = input.registerAnchor("B", path, rowSpan(header), "csv");

  if (candidate !== undefined) {
    const exact = pinnedTarget === candidate.name;
    return [
      {
        id: `BIND-03|B|${path}`,
        ruleId: "BIND-03",
        severity: "info",
        confidence: exact ? "exact" : "inferred",
        title: exact
          ? "Pinned binding: table rows are indexed by this enum"
          : "Candidate binding: enum matches every header column",
        message: exact
          ? `The project profile pins ${path} to enum ${candidate.name} (${candidate.file}) — every header column is a member of that enum.`
          : `Enum ${candidate.name} in ${candidate.file} has one member per header column of ${path} ` +
            `(${candidate.memberCount} members). This looks like the table's index enum — a candidate binding only. ` +
            `Pin it (pin-binding override for ${path}) to make this binding exact.`,
        anchors: [headerAnchor],
        derivation: [
          `Header cells of ${path} (side B): ${headerCells.length}.`,
          `Enum ${candidate.name}: ${candidate.memberCount} members; every header cell present among member names (exact text match, index-enum shape).`,
          exact
            ? `Profile override (pin-binding) pins ${path} to ${candidate.name}.`
            : "No pin — the binding is a candidate (inferred), never a hard fact.",
        ],
      },
    ];
  }

  if (pinnedTarget !== undefined) {
    return [
      {
        id: `BIND-03|B|${path}|pin-missing`,
        ruleId: "BIND-03",
        severity: "info",
        confidence: "exact",
        title: "Pinned binding target not found",
        message:
          `The project profile pins ${path} to "${pinnedTarget}", but no current enum matches that name ` +
          `with the table's header columns. The pinned convention cannot be verified.`,
        anchors: [headerAnchor],
        derivation: [
          `Profile override (pin-binding) for ${path}: "${pinnedTarget}".`,
          "No enum in the current file set covers every header column under that name.",
        ],
      },
    ];
  }

  if (boundByLiteral.has(path)) return [];
  return [
    {
      id: `BIND-04|B|${path}`,
      ruleId: "BIND-04",
      severity: "info",
      confidence: "exact",
      title: "No code reference found for this changed table",
      message:
        `Checked every current file: no string literal names ${path} and no enum matches its header columns. ` +
        `Its runtime use is unknown — if the table is loaded dynamically, pin a binding to make the link exact.`,
      anchors: [headerAnchor],
      derivation: [
        `Searched ${input.current.factsByPath.size} current script file(s) for string literals naming the table and for enums covering every header column.`,
        "No reference found — the absence is exact; the runtime use stays unknown (channel ③).",
      ],
    },
  ];
}

function checkBindings(input: CheckInput): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const delta of input.delta.tables) {
    if (delta.status === "removed") continue;
    findings.push(...bindingFinding(input, delta.path));
  }
  return findings;
}

// ---------------------------------------------------------------------------------------------
// DANGLING-REF — removed symbol still has unresolved references
// ---------------------------------------------------------------------------------------------

function checkDanglingReferences(input: CheckInput): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const script of input.delta.scripts) {
    if (script.symbolsRemoved.length === 0) continue;
    const before = input.base.factsByPath.get(script.path);
    if (before === undefined) continue;
    const after = input.current.factsByPath.get(script.path);
    for (const symbol of script.symbolsRemoved) {
      // Local bindings vanish with their function; only named declarations can dangle.
      if (symbol.scope === "local") continue;
      const baseRefs = before.refs.filter(
        (ref) => ref.resolution.status === "resolved" && ref.resolution.resolvedId === symbol.id,
      );
      if (baseRefs.length === 0) continue;
      const currentRefs =
        after === undefined ? [] : after.refs.filter((ref) => ref.name === symbol.name);
      if (currentRefs.length === 0) continue;
      const anyLive = currentRefs.some(
        (ref) => ref.resolution.status === "resolved" || ref.resolution.status === "ambiguous",
      );
      if (anyLive) continue;
      const anchors: string[] = [input.registerAnchor("A", script.path, symbol.nameSpan, "code")];
      for (const ref of baseRefs.slice(0, MAX_REF_WITNESSES)) {
        anchors.push(input.registerAnchor("A", script.path, ref.span, "code"));
      }
      for (const ref of currentRefs.slice(0, MAX_REF_WITNESSES)) {
        anchors.push(input.registerAnchor("B", script.path, ref.span, "code"));
      }
      findings.push({
        id: `DANGLING-REF|${symbol.id}`,
        ruleId: "DANGLING-REF",
        severity: "major",
        confidence: "exact",
        title: "Removed symbol still has unresolved references",
        message:
          `Symbol ${symbol.name} (${symbol.kind}) was removed in B, but ` +
          `${currentRefs.length} reference(s) with the same name in ${script.path} remain ` +
          `unresolved — no replacement symbol resolves them.`,
        anchors,
        derivation: [
          `Delta matched the symbol as removed: ${symbol.id}.`,
          `${baseRefs.length} reference(s) on side A resolved exactly to it.`,
          `All ${currentRefs.length} same-name reference(s) on side B are unresolved — checked, not guessed.`,
        ],
      });
    }
  }
  return findings;
}

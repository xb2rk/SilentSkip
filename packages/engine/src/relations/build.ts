import { type FactBundle, type FileFacts, resolveName, type SymbolFact } from "../facts/index.js";
import {
  RELATIONS_SCHEMA_VERSION,
  type Relation,
  type RelationConfidence,
  type RelationContext,
  type RelationSet,
} from "./types.js";

/**
 * Build the relation set for a fact bundle.
 *
 * Deterministic: relations are derived only from the bundle (plus the explicit CSV path list)
 * and sorted by id. Rules never guess — a site that does not resolve, or that matches more
 * than one target, simply produces no relation.
 */
export function buildRelations(bundle: FactBundle, context: RelationContext = {}): RelationSet {
  const csvEntries = (context.csvPaths ?? []).map((raw) => ({
    raw,
    norm: normalizePath(raw).toLowerCase(),
  }));
  const bundlePaths = bundle.files.map((file) => normalizePath(file.path));

  const relations: Relation[] = [];
  for (const file of bundle.files) {
    collectRefRelations(file, relations);
    collectCallRelations(file, relations);
    collectImportRelations(file, relations, bundlePaths);
    collectCsvRelations(file, relations, csvEntries);
    if (context.editorGenIndex === true) {
      collectResourceEnumRelations(file, relations, csvEntries);
    }
  }
  relations.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { schemaVersion: RELATIONS_SCHEMA_VERSION, relations };
}

/** `name-refers-to-symbol` / `name-refers-to-import`: resolved references become edges. */
function collectRefRelations(file: FileFacts, out: Relation[]): void {
  for (const ref of file.refs) {
    const resolution = ref.resolution;
    if (resolution.status !== "resolved" || resolution.resolvedId === undefined) continue;

    if (resolution.level === "import") {
      out.push({
        id: relationId("name-refers-to-import", file.path, ref.span.offset, resolution.resolvedId),
        ruleId: "name-refers-to-import",
        from: { file: file.path, span: ref.span },
        to: { file: file.path, importId: resolution.resolvedId },
        confidence: "inferred",
        derivation: [
          `name reference '${ref.name}' (${ref.role}) at line ${ref.span.line}${containerSuffix(ref.container)}`,
          `matched import ${resolution.resolvedId}`,
        ],
      });
      continue;
    }

    const symbol = file.symbols.find((s) => s.id === resolution.resolvedId);
    if (!symbol) continue;
    const confidence = levelConfidence(resolution.level, symbol, ref.container);
    out.push({
      id: relationId("name-refers-to-symbol", file.path, ref.span.offset, symbol.id),
      ruleId: "name-refers-to-symbol",
      from: { file: file.path, span: ref.span },
      to: { file: file.path, span: symbol.nameSpan, symbolId: symbol.id },
      confidence,
      derivation: [
        `name reference '${ref.name}' (${ref.role}) at line ${ref.span.line}${containerSuffix(ref.container)}`,
        `name-level resolution: ${resolution.level}${memberFallbackSuffix(resolution.level, confidence)}`,
        `target: ${symbol.kind} '${symbol.name}' at line ${symbol.nameSpan.line}`,
      ],
    });
  }
}

/**
 * `call-name-resolves` / `call-receiver-import`: bare calls resolve through the shared name
 * ladder; member calls resolve through their receiver matching an import (v1 does not model
 * receiver types).
 */
function collectCallRelations(file: FileFacts, out: Relation[]): void {
  for (const call of file.calls) {
    if (call.receiverText !== undefined) {
      const receiver = singleCandidate(
        file.imports.filter(
          (i) => i.imported === call.receiverText || i.alias === call.receiverText,
        ),
      );
      if (!receiver) continue;
      out.push({
        id: relationId("call-receiver-import", file.path, call.span.offset, receiver.id),
        ruleId: "call-receiver-import",
        from: { file: file.path, span: call.span },
        to: { file: file.path, importId: receiver.id },
        confidence: "inferred",
        derivation: [
          `member call '${call.calleeText}' at line ${call.span.line}${containerSuffix(call.container)}`,
          `receiver '${call.receiverText}' matches import ${receiver.id}`,
        ],
      });
      continue;
    }

    if (call.calleeName === undefined) continue;
    const resolution = resolveName(call.calleeName, call.container, file.symbols, file.imports);
    if (resolution.status !== "resolved" || resolution.resolvedId === undefined) continue;

    if (resolution.level === "import") {
      out.push({
        id: relationId("call-name-resolves", file.path, call.span.offset, resolution.resolvedId),
        ruleId: "call-name-resolves",
        from: { file: file.path, span: call.span },
        to: { file: file.path, importId: resolution.resolvedId },
        confidence: "inferred",
        derivation: [
          `call '${call.calleeText}' at line ${call.span.line}${containerSuffix(call.container)}`,
          `callee matched import ${resolution.resolvedId}`,
        ],
      });
      continue;
    }

    const symbol = file.symbols.find((s) => s.id === resolution.resolvedId);
    if (!symbol) continue;
    const confidence = levelConfidence(resolution.level, symbol, call.container);
    out.push({
      id: relationId("call-name-resolves", file.path, call.span.offset, symbol.id),
      ruleId: "call-name-resolves",
      from: { file: file.path, span: call.span },
      to: { file: file.path, span: symbol.nameSpan, symbolId: symbol.id },
      confidence,
      derivation: [
        `call '${call.calleeText}' at line ${call.span.line}${containerSuffix(call.container)}`,
        `name-level resolution: ${resolution.level}${memberFallbackSuffix(resolution.level, confidence)}`,
        `target: ${symbol.kind} '${symbol.name}' at line ${symbol.nameSpan.line}`,
      ],
    });
  }
}

/** `import-statement` (literal fact) + `import-path-matches-file` (documented convention). */
function collectImportRelations(
  file: FileFacts,
  out: Relation[],
  bundlePaths: readonly string[],
): void {
  for (const imp of file.imports) {
    out.push({
      id: relationId("import-statement", file.path, imp.span.offset, imp.path),
      ruleId: "import-statement",
      from: { file: file.path, span: imp.span },
      to: { file: imp.path },
      confidence: "exact",
      derivation: [`import statement '${imp.path}' at line ${imp.span.line}`],
    });

    const match = matchImportTarget(file.path, imp.path, bundlePaths);
    if (!match) continue;
    out.push({
      id: relationId("import-path-matches-file", file.path, imp.span.offset, match.path),
      ruleId: "import-path-matches-file",
      from: { file: file.path, span: imp.span },
      to: { file: match.path },
      confidence: "inferred",
      derivation: [
        `import path '${imp.path}' from '${file.path}'`,
        match.how === "relative"
          ? `resolved relative to the importing file → '${match.path}'`
          : `suffix match on a unique bundle path → '${match.path}'`,
      ],
    });
  }
}

/** `string-names-csv`: channel ① of §4.5 — a literal filename naming exactly one CSV table. */
function collectCsvRelations(
  file: FileFacts,
  out: Relation[],
  csvEntries: readonly { raw: string; norm: string }[],
): void {
  for (const str of file.strings) {
    const inner = str.innerText;
    const lower = inner.toLowerCase();
    if (!lower.endsWith(".csv") && !lower.endsWith(".tsv")) continue;
    const needle = normalizePath(inner).toLowerCase();
    if (needle.length === 0) continue;

    const matches = csvEntries.filter(
      (entry) => entry.norm === needle || entry.norm.endsWith(`/${needle}`),
    );
    const match = singleCandidate(matches);
    if (!match) continue;
    out.push({
      id: relationId("string-names-csv", file.path, str.span.offset, match.raw),
      ruleId: "string-names-csv",
      from: { file: file.path, span: str.span },
      to: { file: match.raw },
      confidence: "exact",
      derivation: [
        `string literal "${inner}" at line ${str.span.line}`,
        `matches exactly one CSV table: ${match.raw}`,
      ],
    });
  }
}

/** `resource-enum-names-csv`: channel ② of §4.5, gated by the profile editorGen flag. */
function collectResourceEnumRelations(
  file: FileFacts,
  out: Relation[],
  csvEntries: readonly { raw: string; norm: string }[],
): void {
  for (const ref of file.refs) {
    if (ref.role !== "member" || ref.receiver !== "EResCSV") continue;
    const needle = `${ref.name.toLowerCase()}.csv`;
    const matches = csvEntries.filter((entry) => (entry.norm.split("/").pop() ?? "") === needle);
    const match = singleCandidate(matches);
    if (!match) continue;
    out.push({
      id: relationId("resource-enum-names-csv", file.path, ref.span.offset, match.raw),
      ruleId: "resource-enum-names-csv",
      from: { file: file.path, span: ref.span },
      to: { file: match.raw },
      confidence: "exact",
      derivation: [
        `member reference 'EResCSV.${ref.name}' at line ${ref.span.line}`,
        `editorGen indexing is enabled in the project profile`,
        `matches exactly one CSV table by name: ${match.raw}`,
      ],
    });
  }
}

/** Confidence of a name-level resolution: same-container and unique top-level bindings are exact. */
function levelConfidence(
  level: "local" | "member" | "top" | "import" | undefined,
  symbol: SymbolFact,
  refContainer: string | undefined,
): RelationConfidence {
  if (level === "local" || level === "top") return "exact";
  if (level === "member") return symbol.container === refContainer ? "exact" : "inferred";
  return "inferred";
}

/** Human suffix for the member fallback case (member resolved without a same-container match). */
function memberFallbackSuffix(level: string | undefined, confidence: RelationConfidence): string {
  return level === "member" && confidence === "inferred" ? " (any container)" : "";
}

/** Human suffix for a container. */
function containerSuffix(container: string | undefined): string {
  return container !== undefined ? ` in ${container}` : "";
}

/** Deterministic relation id. */
function relationId(ruleId: string, filePath: string, offset: number, targetKey: string): string {
  return `${ruleId}|${filePath}|${offset}|${targetKey}`;
}

/**
 * Match an import path against bundle files: first relative to the importing file (with `..`
 * segments collapsed), then by unique path suffix (search-path convention). Only a unique
 * match produces a target; anything else stays a plain `import-statement`.
 */
function matchImportTarget(
  importerPath: string,
  importPath: string,
  bundlePaths: readonly string[],
): { path: string; how: "relative" | "suffix" } | undefined {
  const needle = normalizePath(importPath);
  if (needle.length === 0) return undefined;
  const importerNorm = normalizePath(importerPath);
  const importerDir = importerNorm.includes("/")
    ? importerNorm.slice(0, importerNorm.lastIndexOf("/"))
    : "";

  const joined = collapseSegments(importerDir.length > 0 ? `${importerDir}/${needle}` : needle);
  if (joined !== undefined) {
    const relativeMatches = bundlePaths.filter(
      (path) =>
        path.toLowerCase() === joined.toLowerCase() &&
        path.toLowerCase() !== importerNorm.toLowerCase(),
    );
    const relative = singleCandidate(relativeMatches);
    if (relative) return { path: relative, how: "relative" };
  }

  const suffixMatches = bundlePaths.filter(
    (path) =>
      path.toLowerCase().endsWith(`/${needle.toLowerCase()}`) &&
      path.toLowerCase() !== importerNorm.toLowerCase(),
  );
  const suffix = singleCandidate(suffixMatches);
  if (suffix) return { path: suffix, how: "suffix" };
  return undefined;
}

/** Collapse `.`/`..` segments; `undefined` when the path escapes above its root. */
function collapseSegments(path: string): string | undefined {
  const stack: string[] = [];
  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      if (stack.length === 0) return undefined;
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return stack.join("/");
}

/** Normalize path separators to forward slashes. */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

/** Exactly-one-or-nothing helper that stays type-safe under `noUncheckedIndexedAccess`. */
function singleCandidate<T>(items: readonly T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined;
}

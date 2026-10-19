import { type CallFact, type FileFacts, resolveName, type SymbolFact } from "../facts/index.js";
import type { CheckFinding, CheckInput } from "./types.js";

/** Maximum reference witnesses per side attached to one DANGLING-REF finding. */
const MAX_REF_WITNESSES = 5;

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
export function checkCallArity(input: CheckInput): CheckFinding[] {
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

/**
 * ORPHAN-ADD-01 — a function added in B whose name appears in no reference, call or import
 * in any scanned source file. The absence is exact within that scope; whether it is dead code
 * or framework-invoked dynamically is not — hence `info` and the note/pin hint. Dynamic
 * invocation through asset files (`.ui`/`.prefab` `funcKey`) is outside this scan.
 * Events are excluded: framework lifecycles can invoke them implicitly by convention.
 */
export function checkOrphanAdditions(input: CheckInput): CheckFinding[] {
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
        effectConfidence: "inferred",
        title: "Added function has no reference in scanned source",
        message: `\`${symbol.name}\` was added to ${script.path} but no reference, call or import name in any scanned source file mentions it. Dynamic invocation (for example a funcKey in a .ui/.prefab asset) is outside this scan — record it as a note/pin; otherwise this may be dead code.`,
        anchors: [input.registerAnchor("B", script.path, symbol.nameSpan, "code")],
        derivation: [
          `Every scanned current file's references, call callees and import names were checked for \`${symbol.name}\` — zero hits.`,
          "The absence is exact within scanned source; why it is unreferenced (dynamic binding, reflection, dead code) is not.",
        ],
      });
    }
  }
  return findings;
}

/**
 * DANGLING-REF — a symbol removed in B still has same-name references in B that resolve
 * nowhere, while the A-side references resolved exactly to the removed symbol.
 */
export function checkDanglingReferences(input: CheckInput): CheckFinding[] {
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

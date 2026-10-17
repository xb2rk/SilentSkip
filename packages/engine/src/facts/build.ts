import {
  type AnySyntaxNode,
  type CallExpressionNode,
  lex,
  type NameNode,
  parseGraphFile,
  parseHeaderFile,
  type QualifiedNameNode,
  type SourceRange,
  type Token,
  TokenId,
  triviaKindOf,
  walkAst,
} from "@craftland-qa/fc-lang";
import {
  type CallFact,
  type ComparisonFact,
  type DocCommentFact,
  FACT_SCHEMA_VERSION,
  type FactBundle,
  type FactSpan,
  type FileFacts,
  type ImportFact,
  type RefFact,
  type RefResolution,
  type RefRole,
  type SourceInput,
  type StringFact,
  type SymbolFact,
  type SymbolKind,
  type SymbolScope,
  type ValueFact,
} from "./types.js";

/**
 * Build the fact bundle for a set of FC sources.
 *
 * Deterministic: files are sorted by path, walkers emit in AST visit order, and the only
 * inputs are the sources themselves. Unknown extensions throw — the caller must filter.
 */
export function buildFactBundle(sources: readonly SourceInput[]): FactBundle {
  const ordered = [...sources].sort((a, b) => a.path.localeCompare(b.path, "en"));
  return { schemaVersion: FACT_SCHEMA_VERSION, files: ordered.map(buildFileFacts) };
}

/** A reference collected during the walk, before the resolution pass. */
interface RawRef {
  name: string;
  role: RefRole;
  span: FactSpan;
  container: string | undefined;
}

function buildFileFacts(input: SourceInput): FileFacts {
  const lowerPath = input.path.toLowerCase();
  let language: "fcc" | "fcg";
  if (lowerPath.endsWith(".fcc")) language = "fcc";
  else if (lowerPath.endsWith(".fcg")) language = "fcg";
  else throw new Error(`Unsupported FC source extension: ${input.path}`);

  const source = input.source;
  const lexed = lex(source);
  const parsed = language === "fcc" ? parseHeaderFile(lexed) : parseGraphFile(lexed);
  const tokens = lexed.tokens;

  const symbols: SymbolFact[] = [];
  const rawRefs: RawRef[] = [];
  const calls: CallFact[] = [];
  const strings: StringFact[] = [];
  const values: ValueFact[] = [];
  const comparisons: ComparisonFact[] = [];
  const imports: ImportFact[] = [];
  const docComments: DocCommentFact[] = [];

  const containerStack: string[] = [];
  const scopeNodes = new WeakSet<AnySyntaxNode>();
  const prefixedCalls = new WeakSet<AnySyntaxNode>();
  const writeTargets = new WeakSet<AnySyntaxNode>();

  const container = (): string | undefined => containerStack[containerStack.length - 1];
  const memberOrTopScope = (): SymbolScope => (containerStack.length === 0 ? "top" : "member");

  const attachDocComments = (declTokenStart: number, symbolId: string): void => {
    const collected: Token[] = [];
    let index = declTokenStart - 1;
    while (index >= 0) {
      const token = tokens[index];
      if (!token) break;
      const trivia = triviaKindOf(token);
      if (trivia === undefined) break;
      if (trivia === "whitespace") {
        if (countLineBreaks(token.text) >= 2) break;
        index -= 1;
        continue;
      }
      collected.unshift(token);
      index -= 1;
    }
    for (const comment of collected) {
      const kind = triviaKindOf(comment);
      if (kind === undefined || kind === "whitespace") continue;
      docComments.push({
        kind,
        text: comment.text,
        span: spanOf(comment.range),
        attachedTo: symbolId,
      });
    }
  };

  const registerSymbol = (
    name: NameNode | QualifiedNameNode | undefined,
    kind: SymbolKind,
    scope: SymbolScope,
    node: AnySyntaxNode,
    paramCount?: number,
  ): string | undefined => {
    if (!name) return undefined;
    const id = `${input.path}#${name.text}@${name.range.start.offset}`;
    const ownContainer = container();
    symbols.push({
      id,
      name: name.text,
      kind,
      ...(paramCount === undefined ? {} : { paramCount }),
      scope,
      ...(ownContainer !== undefined ? { container: ownContainer } : {}),
      span: spanOf(node.range),
      nameSpan: spanOf(name.range),
    });
    if (scope !== "local") attachDocComments(node.tokenRange.start, id);
    return id;
  };

  /** Records the literal initializer of a declaration; non-literal initializers record nothing. */
  const recordValue = (symbolId: string, value: AnySyntaxNode): void => {
    if (value.kind !== "literal-expression") return;
    const token = tokens[value.tokenIndex];
    if (!token) return;
    values.push({
      id: `${input.path}#value@${value.range.start.offset}`,
      symbolId,
      literalKind: value.literalKind,
      rawText: token.text,
      text: stripDelimiters(token.text),
      span: spanOf(value.range),
    });
  };

  const pushScope = (node: AnySyntaxNode, name: NameNode | QualifiedNameNode | undefined): void => {
    if (!name) return;
    scopeNodes.add(node);
    containerStack.push(name.text);
  };

  const recordCall = (call: CallExpressionNode, prefix: "start" | "wait" | undefined): void => {
    const callee = call.callee;
    let calleeName: string | undefined;
    let receiverText: string | undefined;
    if (callee.kind === "name-expression") {
      calleeName = callee.name.text;
    } else if (callee.kind === "member-expression") {
      calleeName = callee.member?.text;
      receiverText = sliceRange(source, callee.object.range);
    }
    const ownContainer = container();
    calls.push({
      span: spanOf(call.range),
      calleeText: sliceRange(source, callee.range),
      ...(calleeName !== undefined ? { calleeName } : {}),
      ...(receiverText !== undefined ? { receiverText } : {}),
      argumentCount: call.arguments.length,
      ...(prefix !== undefined ? { prefix } : {}),
      ...(ownContainer !== undefined ? { container: ownContainer } : {}),
    });
  };

  const visitor = (node: AnySyntaxNode): void => {
    switch (node.kind) {
      // ---- scope nodes: register the symbol, then open the named scope ----
      case "graph-declaration": {
        registerSymbol(node.name, "graph", "top", node);
        pushScope(node, node.name);
        break;
      }
      case "declare-graph": {
        registerSymbol(node.name, "declare-graph", "top", node);
        pushScope(node, node.name);
        break;
      }
      case "enum-declaration": {
        registerSymbol(node.name, "enum", memberOrTopScope(), node);
        pushScope(node, node.name);
        break;
      }
      case "component-declaration": {
        registerSymbol(node.name, "component", memberOrTopScope(), node);
        pushScope(node, node.name);
        break;
      }
      case "tuple-declaration": {
        registerSymbol(node.name, "tuple", memberOrTopScope(), node);
        pushScope(node, node.name);
        break;
      }
      case "function-declaration": {
        registerSymbol(
          node.name,
          "function",
          memberOrTopScope(),
          node,
          node.signature?.parameters.length,
        );
        pushScope(node, node.name);
        break;
      }
      case "event-declaration": {
        registerSymbol(
          node.name,
          "event",
          memberOrTopScope(),
          node,
          node.signature?.parameters.length,
        );
        pushScope(node, node.name);
        break;
      }
      // ---- plain named declarations ----
      case "define-declaration": {
        registerSymbol(node.name, "define", memberOrTopScope(), node);
        break;
      }
      case "alias-declaration": {
        registerSymbol(node.name, "alias", memberOrTopScope(), node);
        break;
      }
      case "enum-member": {
        const id = registerSymbol(node.name, "enum-member", "member", node);
        if (id !== undefined && node.value !== undefined) recordValue(id, node.value);
        break;
      }
      case "field-declaration": {
        const id = registerSymbol(node.name, "field", "member", node);
        if (id !== undefined && node.value !== undefined) recordValue(id, node.value);
        break;
      }
      case "variable-statement": {
        const id = registerSymbol(node.name, "variable", "local", node);
        if (id !== undefined && node.value !== undefined) recordValue(id, node.value);
        break;
      }
      case "parameter": {
        registerSymbol(node.name, "parameter", "local", node);
        break;
      }
      case "for-index-statement": {
        if (node.binding) registerSymbol(node.binding, "for-binding", "local", node.binding);
        break;
      }
      case "for-range-statement": {
        if (node.binding) registerSymbol(node.binding, "for-binding", "local", node.binding);
        if (node.keyBinding)
          registerSymbol(node.keyBinding, "for-binding", "local", node.keyBinding);
        break;
      }
      case "out-var-argument": {
        registerSymbol(node.name, "variable", "local", node);
        break;
      }
      // ---- comparisons: raw syntax material for width/column guards ----
      case "binary-expression": {
        if (isComparisonOperator(node.operator) && node.right !== undefined) {
          const operatorToken = tokens[node.operatorTokenIndices[0] ?? -1];
          const ownContainer = container();
          comparisons.push({
            id: `${input.path}#cmp@${node.range.start.offset}`,
            ...(ownContainer !== undefined ? { container: ownContainer } : {}),
            operatorText:
              operatorToken?.text ??
              source.slice(node.left.range.end.offset, node.right.range.start.offset).trim(),
            leftText: sliceRange(source, node.left.range),
            leftSpan: spanOf(node.left.range),
            rightText: sliceRange(source, node.right.range),
            rightSpan: spanOf(node.right.range),
            span: spanOf(node.range),
          });
        }
        break;
      }
      // ---- references ----
      case "name-expression": {
        if (!writeTargets.has(node)) {
          rawRefs.push({
            name: node.name.text,
            role: "read",
            span: spanOf(node.name.range),
            container: container(),
          });
        }
        break;
      }
      case "member-expression": {
        if (node.member && !writeTargets.has(node)) {
          rawRefs.push({
            name: node.member.text,
            role: "member",
            span: spanOf(node.member.range),
            container: container(),
          });
        }
        break;
      }
      case "assignment-statement": {
        const left = node.left;
        if (left?.kind === "name-expression") {
          writeTargets.add(left);
          rawRefs.push({
            name: left.name.text,
            role: "write",
            span: spanOf(left.name.range),
            container: container(),
          });
        } else if (left?.kind === "member-expression" && left.member) {
          writeTargets.add(left);
          rawRefs.push({
            name: left.member.text,
            role: "write",
            span: spanOf(left.member.range),
            container: container(),
          });
        }
        break;
      }
      // ---- calls ----
      case "prefixed-call-expression": {
        if (node.call) {
          prefixedCalls.add(node.call);
          recordCall(node.call, node.prefix);
        }
        break;
      }
      case "call-expression": {
        if (!prefixedCalls.has(node)) recordCall(node, undefined);
        break;
      }
      // ---- string literals ----
      case "literal-expression": {
        if (node.literalKind === "string" || node.literalKind === "raw-string") {
          const token = tokens[node.tokenIndex];
          if (token) {
            strings.push({
              span: spanOf(node.range),
              rawText: token.text,
              innerText: stripDelimiters(token.text),
            });
          }
        }
        break;
      }
      // ---- imports ----
      case "library-import": {
        const pathToken =
          node.pathTokenIndex !== undefined ? tokens[node.pathTokenIndex] : undefined;
        imports.push({
          id: `${input.path}#import@${node.range.start.offset}`,
          kind: "library",
          path: stripDelimiters(pathToken?.text ?? ""),
          ...(node.alias !== undefined ? { alias: node.alias.text } : {}),
          span: spanOf(node.range),
        });
        break;
      }
      case "named-import": {
        const pathToken =
          node.pathTokenIndex !== undefined ? tokens[node.pathTokenIndex] : undefined;
        imports.push({
          id: `${input.path}#import@${node.range.start.offset}`,
          kind: "named",
          path: stripDelimiters(pathToken?.text ?? ""),
          ...(node.imported !== undefined ? { imported: node.imported.text } : {}),
          ...(node.alias !== undefined ? { alias: node.alias.text } : {}),
          span: spanOf(node.range),
        });
        break;
      }
      default:
        break;
    }
  };

  const exit = (node: AnySyntaxNode): void => {
    if (scopeNodes.has(node)) containerStack.pop();
  };

  if (parsed.node) walkAst(parsed.node, visitor, exit);

  const refs: RefFact[] = rawRefs.map((raw) => ({
    name: raw.name,
    role: raw.role,
    span: raw.span,
    ...(raw.container !== undefined ? { container: raw.container } : {}),
    resolution: resolveRef(raw, symbols, imports),
  }));

  return {
    path: input.path,
    language,
    parse: {
      lexDiagnostics: lexed.diagnostics.length,
      diagnostics: parsed.diagnostics.length,
      consumedThroughEof: parsed.consumedThroughEof,
    },
    symbols,
    refs,
    calls,
    strings,
    values,
    comparisons,
    imports,
    docComments,
  };
}

function resolveRef(
  raw: RawRef,
  symbols: readonly SymbolFact[],
  imports: readonly ImportFact[],
): RefResolution {
  return resolveName(raw.name, raw.container, symbols, imports);
}

/**
 * Name-level resolution (deliberately not full scope analysis): walk the specificity ladder
 * local (same container) → member (same container) → member (any) → top-level → import, and
 * resolve only when exactly one candidate exists at the most specific level. Anything else is
 * reported as ambiguous or unresolved — never guessed.
 *
 * Exported so the relations layer (and later checks) reuse the exact same ladder instead of
 * re-implementing it.
 */
export function resolveName(
  name: string,
  container: string | undefined,
  symbols: readonly SymbolFact[],
  imports: readonly ImportFact[],
): RefResolution {
  const locals = symbols.filter(
    (s) => s.scope === "local" && s.name === name && s.container === container,
  );
  const local = singleCandidate(locals);
  if (local) return { status: "resolved", level: "local", resolvedId: local.id };
  if (locals.length > 1)
    return { status: "ambiguous", level: "local", candidateIds: locals.map((s) => s.id) };

  const membersSame = symbols.filter(
    (s) =>
      s.scope === "member" &&
      s.name === name &&
      s.container !== undefined &&
      s.container === container,
  );
  const memberSame = singleCandidate(membersSame);
  if (memberSame) return { status: "resolved", level: "member", resolvedId: memberSame.id };
  if (membersSame.length > 1) {
    return { status: "ambiguous", level: "member", candidateIds: membersSame.map((s) => s.id) };
  }

  const membersAny = symbols.filter((s) => s.scope === "member" && s.name === name);
  const memberAny = singleCandidate(membersAny);
  if (memberAny) return { status: "resolved", level: "member", resolvedId: memberAny.id };
  if (membersAny.length > 1)
    return { status: "ambiguous", level: "member", candidateIds: membersAny.map((s) => s.id) };

  const tops = symbols.filter((s) => s.scope === "top" && s.name === name);
  const top = singleCandidate(tops);
  if (top) return { status: "resolved", level: "top", resolvedId: top.id };
  if (tops.length > 1)
    return { status: "ambiguous", level: "top", candidateIds: tops.map((s) => s.id) };

  const matchingImports = imports.filter((i) => i.imported === name || i.alias === name);
  const matchedImport = singleCandidate(matchingImports);
  if (matchedImport) return { status: "resolved", level: "import", resolvedId: matchedImport.id };
  if (matchingImports.length > 1) {
    return { status: "ambiguous", level: "import", candidateIds: matchingImports.map((i) => i.id) };
  }

  return { status: "unresolved" };
}

/** Exactly-one-or-nothing helper that stays type-safe under `noUncheckedIndexedAccess`. */
function singleCandidate<T>(items: readonly T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined;
}

/** Comparison operators recorded as {@link ComparisonFact}s (spec §4.7 STRUCT-01 raw material). */
function isComparisonOperator(operator: TokenId): boolean {
  return (
    operator === TokenId.EQUALS ||
    operator === TokenId.NOT_EQUALS ||
    operator === TokenId.LESS ||
    operator === TokenId.GREATER ||
    operator === TokenId.LESS_OR_EQUALS ||
    operator === TokenId.GREATER_OR_EQUALS
  );
}

/** Convert a half-open LSP range into a `FactSpan` (1-based lines, 0-based offsets). */
function spanOf(range: SourceRange): FactSpan {
  const line = range.start.line + 1;
  const endLine = Math.max(line, range.end.column === 0 ? range.end.line : range.end.line + 1);
  return {
    offset: range.start.offset,
    length: range.end.offset - range.start.offset,
    line,
    endLine,
  };
}

/** Count physical line breaks in trivia text (`\r\n` counts once). */
function countLineBreaks(text: string): number {
  let breaks = 0;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text.charAt(index);
    if (ch === "\n") breaks += 1;
    else if (ch === "\r" && text.charAt(index + 1) !== "\n") breaks += 1;
  }
  return breaks;
}

/** Strip matching surrounding string delimiters; escapes are intentionally left as written. */
function stripDelimiters(text: string): string {
  const first = text.charAt(0);
  if (
    (first === '"' || first === "'" || first === "`") &&
    text.length >= 2 &&
    text.charAt(text.length - 1) === first
  ) {
    return text.slice(1, -1);
  }
  return text;
}

/** Exact source slice of a range (used for `calleeText` / `receiverText`). */
function sliceRange(source: string, range: SourceRange): string {
  return source.slice(range.start.offset, range.end.offset);
}

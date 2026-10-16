/**
 * Recursive-descent parser for FC type expressions.
 *
 * @see GRAMMAR.md §3 (Type System)
 */

import { TokenId } from "../grammar/token-vocabulary.generated.js";
import type { NameNode } from "../syntax/core.js";
import type {
  DomainTypeNode,
  FunctionTypeNode,
  FunctionTypeParameterNode,
  GenericTypeNode,
  ScalarTypeNode,
  TypeCoreNode,
} from "../syntax/types.js";
import { RESERVED_SCALAR_TYPE_KINDS, type ParserContext } from "./context.js";

/**
 * Parses a domain-scoped type (e.g. `server.Player`, `int`, `List<string>`).
 */
export function parseDomainType(ctx: ParserContext): DomainTypeNode | undefined {
  const start = ctx.cursor.current().index;
  let domain: NameNode | undefined;
  let dotTokenIndex: number | undefined;

  if (ctx.isGeneralIdentifier() && ctx.cursor.peek(1).token.kind === TokenId.DOT) {
    domain = ctx.parseName();
    dotTokenIndex = ctx.consume(TokenId.DOT, "expected-token", "Expected '.' after type domain.")?.index;
  }

  const type = parseTypeCore(ctx);
  if (!type) {
    ctx.report("expected-type", "Expected an FC type.", ctx.cursor.current().token.range);
    return undefined;
  }

  return {
    ...ctx.nodeSpan("domain-type", start, ctx.lastTokenIndex(type)),
    domain,
    dotTokenIndex,
    kind: "domain-type",
    type,
  };
}

/**
 * Parses the core of a type (scalar, generic, or function type).
 */
export function parseTypeCore(ctx: ParserContext): TypeCoreNode | undefined {
  const current = ctx.cursor.current();
  if (RESERVED_SCALAR_TYPE_KINDS.has(current.token.kind)) {
    const name = ctx.nameFrom(ctx.cursor.advance());
    return {
      ...ctx.nodeSpan("scalar-type", name.tokenIndex, name.tokenIndex),
      kind: "scalar-type",
      name,
      reserved: true,
    } satisfies ScalarTypeNode;
  }

  if (
    current.token.kind === TokenId.LIST ||
    current.token.kind === TokenId.MAP ||
    current.token.kind === TokenId.ENTITY
  ) {
    if (current.token.kind === TokenId.ENTITY && ctx.cursor.peek(1).token.kind !== TokenId.LESS) {
      const name = ctx.nameFrom(ctx.cursor.advance());
      return {
        ...ctx.nodeSpan("scalar-type", name.tokenIndex, name.tokenIndex),
        kind: "scalar-type",
        name,
        reserved: false,
      } satisfies ScalarTypeNode;
    }
    return parseGenericType(ctx);
  }

  if (current.token.kind === TokenId.FUNC) {
    return parseFunctionType(ctx);
  }

  if (ctx.isGeneralIdentifier()) {
    const name = ctx.parseName();
    if (!name) return undefined;
    return {
      ...ctx.nodeSpan("scalar-type", name.tokenIndex, name.tokenIndex),
      kind: "scalar-type",
      name,
      reserved: false,
    } satisfies ScalarTypeNode;
  }

  return undefined;
}

/**
 * Parses a generic type instantiation (e.g. `List<T>`, `Map<K, V>`).
 */
export function parseGenericType(ctx: ParserContext): GenericTypeNode {
  const constructorName = ctx.nameFrom(ctx.cursor.advance());
  const openAngleTokenIndex = ctx.consume(
    TokenId.LESS,
    "expected-token",
    "Expected '<' after generic type name.",
  )?.index;
  const arguments_: DomainTypeNode[] = [];
  const commaTokenIndices: number[] = [];

  let closeAngleTokenIndex: number | undefined;
  ctx.withErrorFence(() => {
    if (openAngleTokenIndex !== undefined) {
      const first = parseDomainType(ctx);
      if (first) {
        arguments_.push(first);
      }
      while (ctx.cursor.at(TokenId.COMMA)) {
        commaTokenIndices.push(ctx.cursor.advance().index);
        const argument = parseDomainType(ctx);
        if (argument) {
          arguments_.push(argument);
        } else {
          break;
        }
      }
    }

    closeAngleTokenIndex = ctx.consume(
      TokenId.GREATER,
      "expected-token",
      "Expected '>' to close generic type.",
    )?.index;
  });

  const end = closeAngleTokenIndex ?? ctx.lastTokenIndex(arguments_.at(-1) ?? constructorName);
  return {
    ...ctx.nodeSpan("generic-type", constructorName.tokenIndex, end),
    arguments: arguments_,
    closeAngleTokenIndex,
    commaTokenIndices,
    constructorName,
    kind: "generic-type",
    openAngleTokenIndex,
  };
}

/**
 * Parses a function signature type `func(param: Type): ReturnType`.
 */
export function parseFunctionType(ctx: ParserContext): FunctionTypeNode {
  const func = ctx.cursor.advance();
  const leftParenTokenIndex = ctx.consume(
    TokenId.L_PAREN,
    "expected-token",
    "Expected '(' after func in function type.",
  )?.index;
  const parameters: FunctionTypeParameterNode[] = [];
  const commaTokenIndices: number[] = [];

  let rightParenTokenIndex: number | undefined;
  ctx.withErrorFence(() => {
    while (!ctx.cursor.at(TokenId.R_PAREN) && !ctx.cursor.at(TokenId.EOF)) {
      const parameterStart = ctx.cursor.current().index;
      const out = ctx.cursor.at(TokenId.OUT) ? ctx.cursor.advance() : undefined;
      const varToken = out
        ? ctx.consume(TokenId.VAR, "expected-token", "Expected 'var' after 'out'.")
        : undefined;
      const name = ctx.parseName();
      const type = parseDomainType(ctx);
      if (!name || !type) break;

      parameters.push({
        ...ctx.nodeSpan("function-type-parameter", parameterStart, ctx.lastTokenIndex(type)),
        kind: "function-type-parameter",
        name,
        outTokenIndex: out?.index,
        type,
        varTokenIndex: varToken?.index,
      });

      if (!ctx.cursor.at(TokenId.COMMA)) break;
      commaTokenIndices.push(ctx.cursor.advance().index);
    }

    rightParenTokenIndex = ctx.consume(
      TokenId.R_PAREN,
      "expected-token",
      "Expected ')' after function type parameters.",
    )?.index;
  });

  const result = ctx.isTypeStart() ? parseDomainType(ctx) : undefined;
  const end = result ? ctx.lastTokenIndex(result) : rightParenTokenIndex ?? func.index;
  return {
    ...ctx.nodeSpan("function-type", func.index, end),
    commaTokenIndices,
    funcTokenIndex: func.index,
    kind: "function-type",
    leftParenTokenIndex,
    parameters,
    result,
    rightParenTokenIndex,
  };
}

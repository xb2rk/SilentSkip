/**
 * Recursive-descent parser for composite literals: positional, map, struct, and LocString.
 *
 * @see GRAMMAR.md §8.3 (Composite Literals)
 */

import { TokenId } from "../grammar/token-vocabulary.generated.js";
import type {
  LocStringExpressionNode,
  MapCompositeEntryNode,
  MapCompositeExpressionNode,
  PositionalCompositeExpressionNode,
  StructCompositeExpressionNode,
  StructCompositeFieldNode,
  ExpressionNode,
} from "../syntax/expressions.js";
import type { DomainTypeNode } from "../syntax/types.js";
import type { CursorToken } from "./cursor.js";
import type { ParserContext } from "./context.js";
import { parseDomainType } from "./type-parser.js";
import { parseExpression, parseQualifiedName } from "./expression-parser.js";

/**
 * Parses a bare composite literal `{ ... }` (positional or map).
 */
export function parseBareComposite(ctx: ParserContext): ExpressionNode {
  const leftCurly = ctx.cursor.advance();
  if (ctx.cursor.at(TokenId.R_CURLY)) {
    return finishPositionalComposite(ctx, undefined, leftCurly, []);
  }
  const first = parseExpression(ctx);
  if (ctx.cursor.at(TokenId.COLON)) {
    return parseMapComposite(ctx, undefined, leftCurly, first);
  }
  return finishPositionalComposite(ctx, undefined, leftCurly, first ? [first] : []);
}

/**
 * Tries to parse a typed collection composite `List<T>{ ... }` or `Map<K, V>{ ... }`.
 */
export function tryParseTypedCollectionComposite(ctx: ParserContext): ExpressionNode | undefined {
  if (
    ctx.cursor.current().token.kind !== TokenId.LIST &&
    ctx.cursor.current().token.kind !== TokenId.MAP
  ) {
    return undefined;
  }
  const cursorCheckpoint = ctx.cursor.checkpoint();
  const diagnosticCheckpoint = ctx.diagnostics.length;
  const fenceCheckpoint = ctx.saveErrorFence();
  const type = parseDomainType(ctx);
  if (!type || !ctx.cursor.at(TokenId.L_CURLY) || type.type.kind !== "generic-type") {
    ctx.cursor.restore(cursorCheckpoint);
    ctx.diagnostics.length = diagnosticCheckpoint;
    ctx.restoreErrorFence(fenceCheckpoint);
    return undefined;
  }
  const leftCurly = ctx.cursor.advance();
  return type.type.constructorName.text === "Map"
    ? parseMapComposite(ctx, type, leftCurly)
    : finishPositionalComposite(ctx, type, leftCurly, []);
}

/**
 * Parses a positional composite with explicit type `Vector3{ 0, 1, 0 }`.
 */
export function parsePositionalComposite(
  ctx: ParserContext,
  type: DomainTypeNode,
  leftCurly: CursorToken,
): PositionalCompositeExpressionNode {
  return finishPositionalComposite(ctx, type, leftCurly, []);
}

/**
 * Finishes parsing positional composite entries between curly braces.
 */
export function finishPositionalComposite(
  ctx: ParserContext,
  type: DomainTypeNode | undefined,
  leftCurly: CursorToken,
  entries: ExpressionNode[],
): PositionalCompositeExpressionNode {
  const commaTokenIndices: number[] = [];
  let trailingCommaTokenIndex: number | undefined;
  let rightCurly: CursorToken | undefined;

  ctx.withErrorFence(() => {
    while (!ctx.cursor.at(TokenId.R_CURLY) && !ctx.cursor.at(TokenId.EOF)) {
      if (entries.length > 0 || ctx.cursor.at(TokenId.COMMA)) {
        if (!ctx.cursor.at(TokenId.COMMA)) break;
        const comma = ctx.cursor.advance();
        commaTokenIndices.push(comma.index);
        if (ctx.cursor.at(TokenId.R_CURLY)) {
          trailingCommaTokenIndex = comma.index;
          break;
        }
      }
      const entry = parseExpression(ctx);
      if (!entry) break;
      entries.push(entry);
    }
    rightCurly = ctx.consume(TokenId.R_CURLY, "expected-token", "Expected '}' after composite entries.");
  });

  const end = rightCurly?.index ?? ctx.lastTokenIndex(entries.at(-1) ?? leftCurly);
  return {
    ...ctx.nodeSpan(
      "positional-composite-expression",
      type ? type.tokenRange.start : leftCurly.index,
      end,
    ),
    commaTokenIndices,
    entries,
    kind: "positional-composite-expression",
    leftCurlyTokenIndex: leftCurly.index,
    rightCurlyTokenIndex: rightCurly?.index,
    trailingCommaTokenIndex,
    type,
  };
}

/**
 * Parses a key-value map composite literal `Map<string, int>{ "a": 1, "b": 2 }`.
 */
export function parseMapComposite(
  ctx: ParserContext,
  type: DomainTypeNode | undefined,
  leftCurly: CursorToken,
  firstKey?: ExpressionNode,
): MapCompositeExpressionNode {
  const entries: MapCompositeEntryNode[] = [];
  const commaTokenIndices: number[] = [];
  let trailingCommaTokenIndex: number | undefined;
  let pendingKey = firstKey;
  let rightCurly: CursorToken | undefined;

  ctx.withErrorFence(() => {
    while (!ctx.cursor.at(TokenId.R_CURLY) && !ctx.cursor.at(TokenId.EOF)) {
      const entryStart = pendingKey
        ? pendingKey.tokenRange.start
        : ctx.cursor.current().index;
      const key = pendingKey ?? parseExpression(ctx);
      pendingKey = undefined;
      const colon = ctx.consume(
        TokenId.COLON,
        "expected-token",
        "Expected ':' between map key and value.",
      );
      const value = parseExpression(ctx);
      const end = ctx.lastTokenIndex(value ?? colon ?? key ?? ctx.cursor.current());
      entries.push({
        ...ctx.nodeSpan("map-composite-entry", entryStart, end),
        colonTokenIndex: colon?.index,
        key,
        kind: "map-composite-entry",
        value,
      });
      if (!ctx.cursor.at(TokenId.COMMA)) break;
      const comma = ctx.cursor.advance();
      commaTokenIndices.push(comma.index);
      if (ctx.cursor.at(TokenId.R_CURLY)) {
        trailingCommaTokenIndex = comma.index;
        break;
      }
    }
    rightCurly = ctx.consume(TokenId.R_CURLY, "expected-token", "Expected '}' after map entries.");
  });

  const end = rightCurly?.index ?? ctx.lastTokenIndex(entries.at(-1) ?? leftCurly);
  return {
    ...ctx.nodeSpan(
      "map-composite-expression",
      type ? type.tokenRange.start : leftCurly.index,
      end,
    ),
    commaTokenIndices,
    entries,
    kind: "map-composite-expression",
    leftCurlyTokenIndex: leftCurly.index,
    rightCurlyTokenIndex: rightCurly?.index,
    trailingCommaTokenIndex,
    type,
  };
}

/**
 * Parses a struct composite literal `TypeName{ field = val, ... }`.
 */
export function parseStructComposite(ctx: ParserContext): StructCompositeExpressionNode {
  const typeName = parseQualifiedName(ctx);
  if (!typeName) {
    throw new Error("Struct composite requires a type name after its lookahead.");
  }
  const first = typeName.segments[0];
  if (!first) {
    throw new Error("Struct composite requires a type name after its lookahead.");
  }
  const leftCurly = ctx.consume(
    TokenId.L_CURLY,
    "expected-token",
    "Expected '{' after struct literal type.",
  );
  if (!leftCurly) {
    throw new Error("Struct composite lookahead lost its opening brace.");
  }
  const fields: StructCompositeFieldNode[] = [];
  const commaTokenIndices: number[] = [];
  let trailingCommaTokenIndex: number | undefined;
  let rightCurly: CursorToken | undefined;

  ctx.withErrorFence(() => {
    while (!ctx.cursor.at(TokenId.R_CURLY) && !ctx.cursor.at(TokenId.EOF)) {
      const fieldStart = ctx.cursor.current().index;
      const name = ctx.parseName();
      const assign = ctx.consume(
        TokenId.ASSIGN,
        "expected-token",
        "Expected '=' after struct literal field name.",
      );
      const value = parseExpression(ctx);
      const end = ctx.lastTokenIndex(value ?? assign ?? name ?? ctx.cursor.current());
      fields.push({
        ...ctx.nodeSpan("struct-composite-field", fieldStart, end),
        assignTokenIndex: assign?.index,
        kind: "struct-composite-field",
        name,
        value,
      });
      if (!ctx.cursor.at(TokenId.COMMA)) break;
      const comma = ctx.cursor.advance();
      commaTokenIndices.push(comma.index);
      if (ctx.cursor.at(TokenId.R_CURLY)) {
        trailingCommaTokenIndex = comma.index;
        break;
      }
    }
    rightCurly = ctx.consume(
      TokenId.R_CURLY,
      "expected-token",
      "Expected '}' after struct literal fields.",
    );
  });

  const end = rightCurly?.index ?? ctx.lastTokenIndex(fields.at(-1) ?? leftCurly);
  return {
    ...ctx.nodeSpan("struct-composite-expression", first.tokenIndex, end),
    commaTokenIndices,
    fields,
    kind: "struct-composite-expression",
    leftCurlyTokenIndex: leftCurly.index,
    rightCurlyTokenIndex: rightCurly?.index,
    trailingCommaTokenIndex,
    typeName,
  };
}

/**
 * Parses a LocString composite `LocString{ key, args... }`.
 */
export function parseLocStringExpression(ctx: ParserContext): LocStringExpressionNode {
  const locString = ctx.cursor.advance();
  const leftCurly = ctx.consume(TokenId.L_CURLY, "expected-token", "Expected '{' after LocString.");
  const key = parseExpression(ctx);
  const comma = ctx.consume(TokenId.COMMA, "expected-token", "LocString requires a comma after its key.");
  const arguments_ = parseLocStringArguments(ctx);
  const rightCurly = ctx.consume(TokenId.R_CURLY, "expected-token", "Expected '}' after LocString arguments.");
  const end = rightCurly?.index ?? ctx.lastTokenIndex(arguments_ ?? key ?? comma ?? leftCurly ?? locString);

  return {
    ...ctx.nodeSpan("loc-string-expression", locString.index, end),
    arguments: arguments_,
    commaTokenIndex: comma?.index,
    key,
    kind: "loc-string-expression",
    leftCurlyTokenIndex: leftCurly?.index,
    locStringTokenIndex: locString.index,
    rightCurlyTokenIndex: rightCurly?.index,
  };
}

function parseLocStringArguments(ctx: ParserContext): PositionalCompositeExpressionNode | undefined {
  if (ctx.cursor.at(TokenId.L_CURLY)) {
    const bare = parseBareComposite(ctx);
    if (bare.kind === "positional-composite-expression") {
      return bare;
    }
    ctx.report("expected-token", "LocString arguments must be a list value, not a map value.", bare.range);
    return undefined;
  }
  const collection = tryParseTypedCollectionComposite(ctx);
  if (collection?.kind === "positional-composite-expression") {
    return collection;
  }
  if (collection) {
    ctx.report("expected-token", "LocString arguments must be a list value.", collection.range);
  } else {
    ctx.report("expected-token", "LocString arguments must be a list value.", ctx.cursor.current().token.range);
  }
  return undefined;
}

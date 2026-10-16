/**
 * Recursive-descent expression parser with operator precedence climbing.
 *
 * @see GRAMMAR.md §8 (Expressions)
 */

import { TokenId, type TokenId as TokenKind } from "../grammar/token-vocabulary.generated.js";
import { containsLineBreak, isTrivia } from "../lex/trivia.js";
import type { NameNode, QualifiedNameNode, SyntaxNode } from "../syntax/core.js";
import type {
  BinaryExpressionNode,
  CallArgumentNode,
  CallExpressionNode,
  ExpressionNode,
  GenericAccessExpressionNode,
  OutVarArgumentNode,
} from "../syntax/expressions.js";
import {
  finishPositionalComposite,
  parseBareComposite,
  parseLocStringExpression,
  parsePositionalComposite,
  parseStructComposite,
  tryParseTypedCollectionComposite,
} from "./composite-parser.js";
import {
  GENERAL_IDENTIFIER_KINDS,
  type CursorToken,
  type ParserContext,
} from "./context.js";
import { parseDomainType } from "./type-parser.js";

const LITERAL_KINDS = new Map<
  number,
  "boolean" | "color" | "float" | "imaginary" | "integer" | "nil" | "raw-string" | "rune" | "string"
>([
  [TokenId.TRUE, "boolean"],
  [TokenId.FALSE, "boolean"],
  [TokenId.NIL_LIT, "nil"],
  [TokenId.DECIMAL_LIT, "integer"],
  [TokenId.BINARY_LIT, "integer"],
  [TokenId.OCTAL_LIT, "integer"],
  [TokenId.HEX_LIT, "integer"],
  [TokenId.FLOAT_LIT, "float"],
  [TokenId.DECIMAL_FLOAT_LIT, "float"],
  [TokenId.HEX_FLOAT_LIT, "float"],
  [TokenId.IMAGINARY_LIT, "imaginary"],
  [TokenId.COLOR_HEX_LIT, "color"],
  [TokenId.RUNE_LIT, "rune"],
  [TokenId.BYTE_VALUE, "rune"],
  [TokenId.OCTAL_BYTE_VALUE, "rune"],
  [TokenId.HEX_BYTE_VALUE, "rune"],
  [TokenId.LITTLE_U_VALUE, "rune"],
  [TokenId.BIG_U_VALUE, "rune"],
  [TokenId.RAW_STRING_LIT, "raw-string"],
  [TokenId.INTERPRETED_STRING_LIT, "string"],
]);

const BINARY_PRECEDENCE = new Map<number, number>([
  [TokenId.LOGICAL_OR, 1],
  [TokenId.LOGICAL_AND, 2],
  [TokenId.EQUALS, 3],
  [TokenId.NOT_EQUALS, 3],
  [TokenId.LESS, 3],
  [TokenId.LESS_OR_EQUALS, 3],
  [TokenId.GREATER, 3],
  [TokenId.GREATER_OR_EQUALS, 3],
  [TokenId.OR, 4],
  [TokenId.XOR, 5],
  [TokenId.AND, 6],
  [TokenId.PLUS, 8],
  [TokenId.MINUS, 8],
  [TokenId.STAR, 9],
  [TokenId.DIV, 9],
  [TokenId.MOD, 9],
]);

const GENERIC_FOLLOWERS = new Set<number>([
  TokenId.DOT,
  TokenId.AS,
  TokenId.COMMA,
  TokenId.R_PAREN,
  TokenId.R_BRACKET,
  TokenId.R_CURLY,
  TokenId.SEMI,
  TokenId.EOF,
  TokenId.ASSIGN,
  TokenId.PLUS_ASSIGN,
  TokenId.MINUS_ASSIGN,
  TokenId.STAR_ASSIGN,
  TokenId.DIV_ASSIGN,
  TokenId.MOD_ASSIGN,
  TokenId.AND_ASSIGN,
  TokenId.XOR_ASSIGN,
  TokenId.OR_ASSIGN,
  TokenId.RSHIFT_ASSIGN,
  TokenId.LSHIFT_ASSIGN,
  TokenId.LOGICAL_OR,
  TokenId.LOGICAL_AND,
  TokenId.EQUALS,
  TokenId.NOT_EQUALS,
  TokenId.LESS,
  TokenId.LESS_OR_EQUALS,
  TokenId.GREATER,
  TokenId.GREATER_OR_EQUALS,
  TokenId.OR,
  TokenId.XOR,
  TokenId.AND,
  TokenId.PLUS,
  TokenId.MINUS,
  TokenId.STAR,
  TokenId.DIV,
  TokenId.MOD,
]);

const UNARY_OPERATOR_IDS = new Set<number>([
  TokenId.EXCLAMATION,
  TokenId.BIT_NOT,
  TokenId.PLUS,
  TokenId.MINUS,
]);

const VECTOR_COMPOSITE_TYPE_IDS = new Set<number>([
  TokenId.VECTOR2,
  TokenId.VECTOR3,
  TokenId.QUATERNION,
]);

/**
 * Parses an FC expression using precedence climbing.
 */
export function parseExpression(
  ctx: ParserContext,
  minimumPrecedence = 0,
  stopAtOpeningBlock = false,
  stopAtVirtualEos = false,
): ExpressionNode | undefined {
  let left = parsePrefixExpression(ctx, stopAtOpeningBlock);
  if (!left) return undefined;

  for (;;) {
    if (stopAtVirtualEos && hasVirtualBoundaryAfter(ctx, left)) return left;
    const postfixed = parsePostfix(ctx, left, true, stopAtVirtualEos, stopAtOpeningBlock);
    if (postfixed !== left) {
      left = postfixed;
      continue;
    }

    if (ctx.cursor.at(TokenId.AS) && 15 >= minimumPrecedence) {
      const asToken = ctx.cursor.advance();
      const type = parseDomainType(ctx);
      left = {
        ...ctx.nodeSpan(
          "cast-expression",
          left.tokenRange.start,
          type ? ctx.lastTokenIndex(type) : asToken.index,
        ),
        asTokenIndex: asToken.index,
        expression: left,
        kind: "cast-expression",
        type,
      };
      continue;
    }

    const operator = peekBinaryOperator(ctx);
    if (!operator || operator.precedence < minimumPrecedence) return left;
    const operatorTokens = operator.consume();
    const right = parseExpression(ctx, operator.precedence + 1, stopAtOpeningBlock, stopAtVirtualEos);
    left = {
      ...ctx.nodeSpan(
        "binary-expression",
        left.tokenRange.start,
        right
          ? ctx.lastTokenIndex(right)
          : operatorTokens.at(-1)?.index ?? ctx.lastTokenIndex(left),
      ),
      kind: "binary-expression",
      left,
      operator: operator.kind,
      operatorTokenIndices: operatorTokens.map((token) => token.index),
      right,
    } satisfies BinaryExpressionNode;
  }
}

/**
 * Parses a prefix expression (unary, prefixed call, literal, composite, or primary).
 */
export function parsePrefixExpression(
  ctx: ParserContext,
  stopAtOpeningBlock = false,
): ExpressionNode | undefined {
  const current = ctx.cursor.current();
  if (current.token.kind === TokenId.START || current.token.kind === TokenId.WAIT) {
    return parsePrefixedCall(ctx);
  }
  if (UNARY_OPERATOR_IDS.has(current.token.kind)) {
    const operator = ctx.cursor.advance();
    const operand = parseExpression(ctx, 14, stopAtOpeningBlock);
    return {
      ...ctx.nodeSpan(
        "unary-expression",
        operator.index,
        operand ? ctx.lastTokenIndex(operand) : operator.index,
      ),
      kind: "unary-expression",
      operand,
      operator: operator.token.kind,
      operatorTokenIndex: operator.index,
    };
  }
  if (current.token.kind === TokenId.TYPEOF) {
    return parseTypeofExpression(ctx);
  }
  if (current.token.kind === TokenId.LOC_STRING && ctx.cursor.peek(1).token.kind === TokenId.L_CURLY) {
    return parseLocStringExpression(ctx);
  }
  if (current.token.kind === TokenId.L_CURLY) {
    return parseBareComposite(ctx);
  }
  const collection = tryParseTypedCollectionComposite(ctx);
  if (collection) {
    return collection;
  }
  if (VECTOR_COMPOSITE_TYPE_IDS.has(current.token.kind) && ctx.cursor.peek(1).token.kind === TokenId.L_CURLY) {
    const type = parseDomainType(ctx);
    if (type && ctx.cursor.at(TokenId.L_CURLY)) {
      return parsePositionalComposite(ctx, type, ctx.cursor.advance());
    }
  }
  if (!stopAtOpeningBlock && ctx.atStructCompositeStart()) {
    return parseStructComposite(ctx);
  }
  if (current.token.kind === TokenId.L_PAREN) {
    return parseParenthesizedExpression(ctx);
  }
  if (current.token.kind === TokenId.THISENTITY || current.token.kind === TokenId.GLOBALENTITY) {
    const token = ctx.cursor.advance();
    return {
      ...ctx.nodeSpan("entity-reference-expression", token.index, token.index),
      kind: "entity-reference-expression",
      reference: token.token.kind === TokenId.THISENTITY ? "thisEntity" : "globalEntity",
      tokenIndex: token.index,
    };
  }
  const literalKind = LITERAL_KINDS.get(current.token.kind);
  if (literalKind) {
    const token = ctx.cursor.advance();
    return {
      ...ctx.nodeSpan("literal-expression", token.index, token.index),
      kind: "literal-expression",
      literalKind,
      tokenIndex: token.index,
    };
  }
  if (ctx.isExpressionName()) {
    const name = ctx.nameFrom(ctx.cursor.advance());
    return {
      ...ctx.nodeSpan("name-expression", name.tokenIndex, name.tokenIndex),
      kind: "name-expression",
      name,
    };
  }
  ctx.report("expected-expression", "Expected an FC expression.", current.token.range);
  return undefined;
}

/**
 * Parses postfix operations: call `()`, index `[]`, member `.`, generic `<>`.
 */
export function parsePostfix(
  ctx: ParserContext,
  expression: ExpressionNode,
  allowCall: boolean,
  stopAtVirtualEos = false,
  allowOpeningBlockFollower = false,
): ExpressionNode {
  let current = expression;
  for (;;) {
    if (stopAtVirtualEos && hasVirtualBoundaryAfter(ctx, current)) return current;
    if (allowCall && ctx.cursor.at(TokenId.L_PAREN)) {
      current = parseCall(ctx, current);
    } else if (ctx.cursor.at(TokenId.L_BRACKET)) {
      current = parseIndex(ctx, current);
    } else if (ctx.cursor.at(TokenId.DOT)) {
      current = parseMember(ctx, current);
    } else {
      const generic = tryParseGenericAccess(ctx, current, allowOpeningBlockFollower);
      if (!generic) return current;
      current = generic;
    }
  }
}

/**
 * Parses function call arguments `(arg1, arg2, ...)`.
 */
export function parseCall(ctx: ParserContext, callee: ExpressionNode): CallExpressionNode {
  const leftParen = ctx.cursor.advance();
  const arguments_: CallArgumentNode[] = [];
  const commaTokenIndices: number[] = [];
  let trailingCommaTokenIndex: number | undefined;
  let rightParen: CursorToken | undefined;

  ctx.withErrorFence(() => {
    while (!ctx.cursor.at(TokenId.R_PAREN) && !ctx.cursor.at(TokenId.EOF)) {
      const argument = ctx.cursor.at(TokenId.OUT)
        ? parseOutVarArgument(ctx)
        : parseExpression(ctx);
      if (!argument) break;
      arguments_.push(argument);
      if (!ctx.cursor.at(TokenId.COMMA)) break;
      const comma = ctx.cursor.advance();
      commaTokenIndices.push(comma.index);
      if (ctx.cursor.at(TokenId.R_PAREN)) {
        trailingCommaTokenIndex = comma.index;
        break;
      }
    }
    rightParen = ctx.consume(TokenId.R_PAREN, "expected-token", "Expected ')' after call arguments.");
  });

  return {
    ...ctx.nodeSpan(
      "call-expression",
      callee.tokenRange.start,
      rightParen?.index ?? ctx.lastTokenIndex(arguments_.at(-1) ?? callee),
    ),
    arguments: arguments_,
    callee,
    commaTokenIndices,
    kind: "call-expression",
    leftParenTokenIndex: leftParen.index,
    rightParenTokenIndex: rightParen?.index,
    trailingCommaTokenIndex,
  };
}

export function parseOutVarArgument(ctx: ParserContext): OutVarArgumentNode {
  const out = ctx.cursor.advance();
  const varToken = ctx.consume(TokenId.VAR, "expected-token", "Expected 'var' after 'out'.");
  const name = ctx.parseName();
  return {
    ...ctx.nodeSpan("out-var-argument", out.index, ctx.lastTokenIndex(name ?? varToken ?? out)),
    kind: "out-var-argument",
    name,
    outTokenIndex: out.index,
    varTokenIndex: varToken?.index,
  };
}

export function parseIndex(ctx: ParserContext, object: ExpressionNode): ExpressionNode {
  const leftBracket = ctx.cursor.advance();
  const index = parseExpression(ctx);
  const rightBracket = ctx.consume(
    TokenId.R_BRACKET,
    "expected-token",
    "Expected ']' after index expression.",
  );
  return {
    ...ctx.nodeSpan(
      "index-expression",
      object.tokenRange.start,
      rightBracket?.index ?? ctx.lastTokenIndex(index ?? leftBracket),
    ),
    index,
    kind: "index-expression",
    leftBracketTokenIndex: leftBracket.index,
    object,
    rightBracketTokenIndex: rightBracket?.index,
  };
}

export function parseMember(ctx: ParserContext, object: ExpressionNode): ExpressionNode {
  const dot = ctx.cursor.advance();
  const member = ctx.parseName();
  return {
    ...ctx.nodeSpan("member-expression", object.tokenRange.start, ctx.lastTokenIndex(member ?? dot)),
    dotTokenIndex: dot.index,
    kind: "member-expression",
    member,
    object,
  };
}

export function parsePrefixedCall(ctx: ParserContext): ExpressionNode {
  const prefix = ctx.cursor.advance();
  let target = parsePrefixExpression(ctx);
  if (target) {
    target = parsePostfix(ctx, target, false);
  }
  let call: CallExpressionNode | undefined;
  if (target && ctx.cursor.at(TokenId.L_PAREN)) {
    call = parseCall(ctx, target);
  } else {
    ctx.report("expected-token", "Expected a call after start/wait.", ctx.cursor.current().token.range);
  }
  const end = call
    ? ctx.lastTokenIndex(call)
    : target
      ? ctx.lastTokenIndex(target)
      : prefix.index;
  return {
    ...ctx.nodeSpan("prefixed-call-expression", prefix.index, end),
    call,
    kind: "prefixed-call-expression",
    prefix: prefix.token.kind === TokenId.START ? "start" : "wait",
    prefixTokenIndex: prefix.index,
    target,
  };
}

export function parseParenthesizedExpression(ctx: ParserContext): ExpressionNode {
  const leftParen = ctx.cursor.advance();
  const expression = parseExpression(ctx);
  const rightParen = ctx.consume(
    TokenId.R_PAREN,
    "expected-token",
    "Expected ')' after parenthesized expression.",
  );
  return {
    ...ctx.nodeSpan(
      "parenthesized-expression",
      leftParen.index,
      rightParen?.index ?? ctx.lastTokenIndex(expression ?? leftParen),
    ),
    expression,
    kind: "parenthesized-expression",
    leftParenTokenIndex: leftParen.index,
    rightParenTokenIndex: rightParen?.index,
  };
}

export function parseTypeofExpression(ctx: ParserContext): ExpressionNode {
  const typeofToken = ctx.cursor.advance();
  const leftParen = ctx.consume(TokenId.L_PAREN, "expected-token", "Expected '(' after typeof.");
  const type = parseDomainType(ctx);
  const rightParen = ctx.consume(TokenId.R_PAREN, "expected-token", "Expected ')' after typeof type.");
  return {
    ...ctx.nodeSpan(
      "typeof-expression",
      typeofToken.index,
      rightParen?.index ?? ctx.lastTokenIndex(type ?? typeofToken),
    ),
    kind: "typeof-expression",
    leftParenTokenIndex: leftParen?.index,
    rightParenTokenIndex: rightParen?.index,
    type,
    typeofTokenIndex: typeofToken.index,
  };
}

export function parseQualifiedName(ctx: ParserContext): QualifiedNameNode | undefined {
  const first = ctx.parseName();
  if (!first) return undefined;
  const segments: NameNode[] = [first];
  const dotTokenIndices: number[] = [];
  while (
    ctx.cursor.at(TokenId.DOT) &&
    GENERAL_IDENTIFIER_KINDS.has(ctx.cursor.peek(1).token.kind)
  ) {
    dotTokenIndices.push(ctx.cursor.advance().index);
    const segment = ctx.parseName();
    if (!segment) break;
    segments.push(segment);
  }
  const last = segments.at(-1) ?? first;
  return {
    ...ctx.nodeSpan("qualified-name", first.tokenIndex, last.tokenIndex),
    dotTokenIndices,
    kind: "qualified-name",
    segments,
    text: segments.map((segment) => segment.text).join("."),
  };
}

export function peekBinaryOperator(
  ctx: ParserContext,
): { consume: () => readonly CursorToken[]; kind: TokenKind; precedence: number } | undefined {
  const current = ctx.cursor.current();
  const next = ctx.cursor.peek(1);
  if (
    (current.token.kind === TokenId.LESS && next.token.kind === TokenId.LESS) ||
    (current.token.kind === TokenId.GREATER && next.token.kind === TokenId.GREATER)
  ) {
    return {
      consume: () => [ctx.cursor.advance(), ctx.cursor.advance()],
      kind: current.token.kind,
      precedence: 7,
    };
  }
  const precedence = BINARY_PRECEDENCE.get(current.token.kind);
  if (precedence === undefined) return undefined;
  return { consume: () => [ctx.cursor.advance()], kind: current.token.kind, precedence };
}

export function tryParseGenericAccess(
  ctx: ParserContext,
  object: ExpressionNode,
  allowOpeningBlockFollower = false,
): GenericAccessExpressionNode | undefined {
  if (!ctx.cursor.at(TokenId.LESS)) return undefined;
  const cursorCheckpoint = ctx.cursor.checkpoint();
  const diagnosticCheckpoint = ctx.diagnostics.length;
  const fenceCheckpoint = ctx.saveErrorFence();
  const open = ctx.cursor.advance();
  const typeArgument = parseDomainType(ctx);
  const close =
    typeArgument && ctx.cursor.at(TokenId.GREATER) ? ctx.cursor.advance() : undefined;
  if (
    !typeArgument ||
    !close ||
    (!GENERIC_FOLLOWERS.has(ctx.cursor.current().token.kind) &&
      !(allowOpeningBlockFollower && ctx.cursor.at(TokenId.L_CURLY)) &&
      !hasVirtualBoundaryAfterToken(ctx, close.index))
  ) {
    ctx.cursor.restore(cursorCheckpoint);
    ctx.diagnostics.length = diagnosticCheckpoint;
    ctx.restoreErrorFence(fenceCheckpoint);
    return undefined;
  }
  return {
    ...ctx.nodeSpan("generic-access-expression", object.tokenRange.start, close.index),
    closeAngleTokenIndex: close.index,
    kind: "generic-access-expression",
    object,
    openAngleTokenIndex: open.index,
    typeArgument,
  };
}

export function hasVirtualBoundaryAfter(ctx: ParserContext, node: SyntaxNode): boolean {
  return hasVirtualBoundaryAfterToken(ctx, ctx.lastTokenIndex(node));
}

export function hasVirtualBoundaryAfterToken(ctx: ParserContext, endTokenIndex: number): boolean {
  return ctx.tokens
    .slice(endTokenIndex + 1, ctx.cursor.current().index)
    .some((token) => isTrivia(token) && containsLineBreak(token));
}

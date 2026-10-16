/**
 * Recursive-descent statement parser for blocks, loops, branches, and variable declarations.
 *
 * @see GRAMMAR.md §9 (Statements)
 */

import { TokenId, type TokenId as TokenKind } from "../grammar/token-vocabulary.generated.js";
import type { ExpressionNode } from "../syntax/expressions.js";
import type {
  AssignmentStatementNode,
  BlockNode,
  ForStatementNode,
  IfStatementNode,
  StatementNode,
  VariableStatementNode,
  WhileStatementNode,
} from "../syntax/statements.js";
import type { ParserContext } from "./context.js";
import { parseExpression } from "./expression-parser.js";
import { BLOCK_STATEMENT_SYNC } from "./recovery.js";
import { parseDomainType } from "./type-parser.js";

const ASSIGNMENT_KINDS = new Set<number>([
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
]);

/**
 * Tokens that start a new statement but cannot open an expression.
 * Used to disambiguate a bare `return;` from a return value expression.
 */
const RETURN_BARE_FOLLOW_KINDS = new Set<number>([
  TokenId.VAR,
  TokenId.IF,
  TokenId.WHILE,
  TokenId.FOR,
  TokenId.RETURN,
  TokenId.BREAK,
  TokenId.CONTINUE,
  TokenId.L_CURLY,
  TokenId.SEMI,
  TokenId.EOF,
]);

/**
 * Parses a braced code block `{ ... }`.
 */
export function parseBlock(ctx: ParserContext): BlockNode {
  const left = ctx.cursor.advance();
  const statements: StatementNode[] = [];

  while (!ctx.cursor.at(TokenId.R_CURLY) && !ctx.cursor.at(TokenId.EOF)) {
    const before = ctx.cursor.checkpoint();
    const statement = parseStatement(ctx);
    if (statement) {
      statements.push(statement);
    } else {
      ctx.recover("Expected a statement.", BLOCK_STATEMENT_SYNC);
    }
    ctx.consumeOptionalSemi();
    if (ctx.cursor.checkpoint() === before) {
      ctx.cursor.advance();
    }
  }

  const right = ctx.consume(TokenId.R_CURLY, "expected-token", "Expected '}' after code block.");
  return {
    ...ctx.nodeSpan("block", left.index, ctx.lastTokenIndex(right ?? statements.at(-1) ?? left)),
    kind: "block",
    leftCurlyTokenIndex: left.index,
    rightCurlyTokenIndex: right?.index,
    statements,
  };
}

/**
 * Parses any valid statement in a block body.
 */
export function parseStatement(ctx: ParserContext): StatementNode | undefined {
  const current = ctx.cursor.current();
  if (current.token.kind === TokenId.RETURN) {
    const keyword = ctx.cursor.advance();
    const next = ctx.cursor.current().token.kind;
    const expression =
      ctx.cursor.at(TokenId.R_CURLY) || RETURN_BARE_FOLLOW_KINDS.has(next)
        ? undefined
        : parseExpression(ctx, 0, false, true);
    return {
      ...ctx.nodeSpan("return-statement", keyword.index, ctx.lastTokenIndex(expression ?? keyword)),
      expression,
      kind: "return-statement",
      returnTokenIndex: keyword.index,
    };
  }

  if (current.token.kind === TokenId.BREAK || current.token.kind === TokenId.CONTINUE) {
    const keyword = ctx.cursor.advance();
    return {
      ...ctx.nodeSpan(
        keyword.token.kind === TokenId.BREAK ? "break-statement" : "continue-statement",
        keyword.index,
        keyword.index,
      ),
      kind: keyword.token.kind === TokenId.BREAK ? "break-statement" : "continue-statement",
      keywordTokenIndex: keyword.index,
    };
  }

  if (current.token.kind === TokenId.VAR) return parseVariableStatement(ctx);
  if (current.token.kind === TokenId.IF) return parseIfStatement(ctx);
  if (current.token.kind === TokenId.WHILE) return parseWhileStatement(ctx);
  if (current.token.kind === TokenId.FOR) return parseForStatement(ctx);
  if (current.token.kind === TokenId.L_CURLY) return parseBlock(ctx);

  const left = parseExpression(ctx, 0, false, true);
  if (!left) return undefined;

  if (ASSIGNMENT_KINDS.has(ctx.cursor.current().token.kind)) {
    const operator = ctx.cursor.advance();
    const right = parseExpression(ctx, 0, false, true);
    return {
      ...ctx.nodeSpan("assignment-statement", left.tokenRange.start, ctx.lastTokenIndex(right ?? operator)),
      kind: "assignment-statement",
      left,
      operator: operator.token.kind as TokenKind,
      operatorTokenIndex: operator.index,
      right,
    } satisfies AssignmentStatementNode;
  }

  if (ctx.cursor.at(TokenId.PLUS_PLUS) || ctx.cursor.at(TokenId.MINUS_MINUS)) {
    const operator = ctx.cursor.advance();
    return {
      ...ctx.nodeSpan("assignment-statement", left.tokenRange.start, operator.index),
      kind: "assignment-statement",
      left,
      operator: operator.token.kind as TokenKind,
      operatorTokenIndex: operator.index,
      right: undefined,
    } satisfies AssignmentStatementNode;
  }

  return {
    ...ctx.nodeSpan("expression-statement", left.tokenRange.start, ctx.lastTokenIndex(left)),
    expression: left,
    kind: "expression-statement",
  };
}

/**
 * Parses a variable declaration statement `var name [type] [= val]`.
 */
export function parseVariableStatement(ctx: ParserContext): VariableStatementNode {
  const varToken = ctx.cursor.advance();
  const name = ctx.parseName();
  const type = ctx.isTypeStart() ? parseDomainType(ctx) : undefined;
  const assign = ctx.cursor.at(TokenId.ASSIGN) ? ctx.cursor.advance() : undefined;
  const value = assign ? parseExpression(ctx, 0, false, true) : undefined;
  return {
    ...ctx.nodeSpan(
      "variable-statement",
      varToken.index,
      ctx.lastTokenIndex(value ?? assign ?? type ?? name ?? varToken),
    ),
    assignTokenIndex: assign?.index,
    kind: "variable-statement",
    name,
    type,
    value,
    varTokenIndex: varToken.index,
  };
}

/**
 * Parses an if-statement with optional else-if / else branches.
 */
export function parseIfStatement(ctx: ParserContext): IfStatementNode {
  const ifToken = ctx.cursor.advance();
  const condition = parseExpression(ctx, 0, true);
  const consequent = ctx.cursor.at(TokenId.L_CURLY) ? parseBlock(ctx) : undefined;
  let elseTokenIndex: number | undefined;
  let alternate: BlockNode | IfStatementNode | undefined;

  if (ctx.cursor.at(TokenId.ELSE)) {
    elseTokenIndex = ctx.cursor.advance().index;
    alternate = ctx.cursor.at(TokenId.IF)
      ? parseIfStatement(ctx)
      : ctx.cursor.at(TokenId.L_CURLY)
        ? parseBlock(ctx)
        : undefined;
  }

  return {
    ...ctx.nodeSpan(
      "if-statement",
      ifToken.index,
      ctx.lastTokenIndex(alternate ?? consequent ?? condition ?? ifToken),
    ),
    alternate,
    condition,
    consequent,
    elseTokenIndex,
    ifTokenIndex: ifToken.index,
    kind: "if-statement",
  };
}

/**
 * Parses a while loop `while (condition) { ... }`.
 */
export function parseWhileStatement(ctx: ParserContext): WhileStatementNode {
  const keyword = ctx.cursor.advance();
  const condition = parseExpression(ctx, 0, true);
  const body = ctx.cursor.at(TokenId.L_CURLY) ? parseBlock(ctx) : undefined;
  return {
    ...ctx.nodeSpan("while-statement", keyword.index, ctx.lastTokenIndex(body ?? condition ?? keyword)),
    body,
    condition,
    kind: "while-statement",
    whileTokenIndex: keyword.index,
  };
}

/**
 * Parses a for loop (index loop, range loop, or expression header loop).
 */
export function parseForStatement(ctx: ParserContext): ForStatementNode {
  const keyword = ctx.cursor.advance();
  const leftParen = ctx.cursor.at(TokenId.L_PAREN) ? ctx.cursor.advance() : undefined;
  const headerCheckpoint = ctx.cursor.checkpoint();
  const firstName = ctx.isGeneralIdentifier() ? ctx.parseName() : undefined;

  if (firstName && ctx.cursor.at(TokenId.ASSIGN)) {
    const assign = ctx.cursor.advance();
    const start = parseExpression(ctx, 0, true);
    const commas: number[] = [];
    let end: ExpressionNode | undefined;
    let step: ExpressionNode | undefined;
    if (ctx.cursor.at(TokenId.COMMA)) {
      commas.push(ctx.cursor.advance().index);
      end = parseExpression(ctx, 0, true);
      if (ctx.cursor.at(TokenId.COMMA)) {
        commas.push(ctx.cursor.advance().index);
        step = parseExpression(ctx, 0, true);
      }
    }
    const rightParen = leftParen
      ? ctx.consume(TokenId.R_PAREN, "expected-token", "Expected ')' after for-loop header.")
      : undefined;
    const body = ctx.cursor.at(TokenId.L_CURLY) ? parseBlock(ctx) : undefined;
    return {
      ...ctx.nodeSpan(
        "for-index-statement",
        keyword.index,
        ctx.lastTokenIndex(body ?? rightParen ?? step ?? end ?? start ?? assign),
      ),
      assignTokenIndex: assign.index,
      binding: firstName,
      body,
      commaTokenIndices: commas,
      end,
      forTokenIndex: keyword.index,
      kind: "for-index-statement",
      leftParenTokenIndex: leftParen?.index,
      rightParenTokenIndex: rightParen?.index,
      start,
      step,
    } satisfies ForStatementNode;
  }

  if (firstName && ctx.cursor.at(TokenId.COMMA)) {
    const comma = ctx.cursor.advance();
    const keyBinding = ctx.isGeneralIdentifier() ? ctx.parseName() : undefined;
    const inToken = ctx.consume(TokenId.IN, "expected-token", "Expected 'in' after range loop bindings.");
    const iterable = parseExpression(ctx, 0, true);
    const rightParen = leftParen
      ? ctx.consume(TokenId.R_PAREN, "expected-token", "Expected ')' after for-loop header.")
      : undefined;
    const body = ctx.cursor.at(TokenId.L_CURLY) ? parseBlock(ctx) : undefined;
    return {
      ...ctx.nodeSpan(
        "for-range-statement",
        keyword.index,
        ctx.lastTokenIndex(body ?? iterable ?? inToken ?? keyBinding ?? comma),
      ),
      binding: firstName,
      body,
      forTokenIndex: keyword.index,
      inTokenIndex: inToken?.index,
      kind: "for-range-statement",
      keyBinding,
      iterable,
      leftParenTokenIndex: leftParen?.index,
      rightParenTokenIndex: rightParen?.index,
    } satisfies ForStatementNode;
  }

  ctx.cursor.restore(headerCheckpoint);
  const expression = parseExpression(ctx, 0, true);
  const rightParen = leftParen
    ? ctx.consume(TokenId.R_PAREN, "expected-token", "Expected ')' after for-loop header.")
    : undefined;
  const body = ctx.cursor.at(TokenId.L_CURLY) ? parseBlock(ctx) : undefined;
  return {
    ...ctx.nodeSpan(
      "for-expression-statement",
      keyword.index,
      ctx.lastTokenIndex(body ?? rightParen ?? expression ?? keyword),
    ),
    body,
    expression,
    forTokenIndex: keyword.index,
    kind: "for-expression-statement",
    leftParenTokenIndex: leftParen?.index,
    rightParenTokenIndex: rightParen?.index,
  } satisfies ForStatementNode;
}

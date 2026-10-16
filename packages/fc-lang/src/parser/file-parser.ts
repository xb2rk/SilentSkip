/**
 * Top-level file parsers for `.fcc` header and `.fcg` graph files.
 *
 * @see GRAMMAR.md §4 (Declarations & Source Files)
 */

import { TokenId } from "../grammar/token-vocabulary.generated.js";
import type { LexResult } from "../lex/lexer.js";
import type {
  GraphDeclarationNode,
  GraphFileNode,
  HeaderDeclarationNode,
  HeaderFileNode,
} from "../syntax/declarations.js";
import type { ExpressionNode } from "../syntax/expressions.js";
import type { DomainTypeNode } from "../syntax/types.js";
import { ParserContext, type ParseResult } from "./context.js";
import {
  parseDecorators,
  parseGraphDeclaration,
  parseHeaderDeclaration,
  parseImports,
} from "./declaration-parser.js";
import { parseExpression as parseAstExpression } from "./expression-parser.js";
import { HEADER_DECL_SYNC } from "./recovery.js";
import { parseDomainType as parseAstDomainType } from "./type-parser.js";

/**
 * Parses a complete `.fcc` header file without making formatting decisions.
 */
export function parseHeaderFile(lexed: LexResult): ParseResult<HeaderFileNode> {
  const ctx = new ParserContext(lexed.tokens);
  const start = ctx.cursor.current().index;
  const imports = parseImports(ctx);
  const declarations: HeaderDeclarationNode[] = [];

  while (!ctx.cursor.at(TokenId.EOF)) {
    const before = ctx.cursor.checkpoint();
    const decorators = parseDecorators(ctx);
    const declaration = parseHeaderDeclaration(ctx, decorators);
    if (declaration) {
      declarations.push(declaration);
    } else {
      ctx.recover("Expected a header declaration.", HEADER_DECL_SYNC);
    }
    if (ctx.cursor.checkpoint() === before) {
      ctx.cursor.advance();
    }
  }

  const end = ctx.cursor.current().index;
  return ctx.result({
    ...ctx.nodeSpan("header-file", start, end),
    declarations,
    imports,
    kind: "header-file",
  });
}

/**
 * Parses a complete `.fcg` graph file, including its graph members and code blocks.
 */
export function parseGraphFile(lexed: LexResult): ParseResult<GraphFileNode> {
  const ctx = new ParserContext(lexed.tokens);
  const start = ctx.cursor.current().index;
  const imports = parseImports(ctx);
  const decorators = parseDecorators(ctx);
  const graph: GraphDeclarationNode | undefined = ctx.cursor.at(TokenId.EOF)
    ? undefined
    : parseGraphDeclaration(ctx, decorators);

  if (!graph && !ctx.cursor.at(TokenId.EOF)) {
    ctx.recover("Expected a graph declaration.");
  }
  ctx.reportTrailingInput();
  const end = ctx.cursor.current().index;
  return ctx.result({
    ...ctx.nodeSpan("graph-file", start, end),
    graph,
    imports,
    kind: "graph-file",
  });
}

/**
 * Helper to parse a standalone expression from a lex result (useful for testing or sub-expression evaluation).
 */
export function parseExpression(lexed: LexResult): ParseResult<ExpressionNode> {
  const ctx = new ParserContext(lexed.tokens);
  const node = parseAstExpression(ctx);
  ctx.reportTrailingInput();
  return ctx.result(node);
}

/**
 * Helper to parse a standalone domain type from a lex result (useful for testing or sub-type evaluation).
 */
export function parseDomainType(lexed: LexResult): ParseResult<DomainTypeNode> {
  const ctx = new ParserContext(lexed.tokens);
  const node = parseAstDomainType(ctx);
  ctx.reportTrailingInput();
  return ctx.result(node);
}

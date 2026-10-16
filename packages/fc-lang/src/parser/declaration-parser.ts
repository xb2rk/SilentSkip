/**
 * Recursive-descent parser for top-level header and graph declarations.
 *
 * @see GRAMMAR.md §4-7 (Declarations)
 */

import { TokenId, type TokenId as TokenKind } from "../grammar/token-vocabulary.generated.js";
import type {
  AggregateDeclarationNode,
  AliasDeclarationNode,
  DecoratorNode,
  DeclareGraphNode,
  DefineDeclarationNode,
  EnumDeclarationNode,
  EnumMemberNode,
  EventDeclarationNode,
  FieldDeclarationNode,
  FunctionDeclarationNode,
  GraphDeclarationNode,
  HeaderDeclarationNode,
  ImportNode,
  ParameterNode,
  SignatureNode,
  TypeCombinationNode,
} from "../syntax/declarations.js";
import type { DomainTypeNode } from "../syntax/types.js";
import type { CursorToken, ParserContext } from "./context.js";
import { parseExpression, parseQualifiedName } from "./expression-parser.js";
import {
  AGGREGATE_FIELD_SYNC,
  DECLARE_GRAPH_MEMBER_SYNC,
  ENUM_MEMBER_SYNC,
  GRAPH_MEMBER_SYNC,
} from "./recovery.js";
import { parseBlock } from "./statement-parser.js";
import { parseDomainType } from "./type-parser.js";

const STRING_KINDS = new Set<number>([
  TokenId.INTERPRETED_STRING_LIT,
  TokenId.RAW_STRING_LIT,
]);

/**
 * Parses consecutive import statements at the top of a file.
 */
export function parseImports(ctx: ParserContext): ImportNode[] {
  const imports: ImportNode[] = [];
  while (ctx.cursor.at(TokenId.IMPORT)) {
    imports.push(parseImport(ctx));
  }
  return imports;
}

/**
 * Parses a single import statement (library import or named import).
 */
export function parseImport(ctx: ParserContext): ImportNode {
  const importToken = ctx.cursor.advance();
  if (STRING_KINDS.has(ctx.cursor.current().token.kind)) {
    const path = ctx.cursor.advance();
    const asToken = ctx.consume(TokenId.AS, "expected-token", "Library imports require 'as Alias'.");
    const alias = ctx.parseName();
    return {
      ...ctx.nodeSpan("library-import", importToken.index, ctx.lastTokenIndex(alias ?? asToken ?? path)),
      alias,
      asTokenIndex: asToken?.index,
      importTokenIndex: importToken.index,
      kind: "library-import",
      pathTokenIndex: path.index,
    };
  }

  const imported = ctx.parseName();
  const asToken = ctx.cursor.at(TokenId.AS) ? ctx.cursor.advance() : undefined;
  const alias = asToken ? ctx.parseName() : undefined;
  const fromToken = ctx.consume(TokenId.FROM, "expected-token", 'Named imports require \'from "path"\'.');
  const path = STRING_KINDS.has(ctx.cursor.current().token.kind) ? ctx.cursor.advance() : undefined;
  if (!path) {
    ctx.report(
      "expected-token",
      "Expected a string import path after 'from'.",
      ctx.cursor.current().token.range,
    );
  }
  return {
    ...ctx.nodeSpan(
      "named-import",
      importToken.index,
      ctx.lastTokenIndex(path ?? alias ?? fromToken ?? imported ?? importToken),
    ),
    alias,
    asTokenIndex: asToken?.index,
    fromTokenIndex: fromToken?.index,
    importTokenIndex: importToken.index,
    imported,
    kind: "named-import",
    pathTokenIndex: path?.index,
  };
}

/**
 * Parses decorators `[DecoratorName(args...)]`.
 */
export function parseDecorators(ctx: ParserContext): DecoratorNode[] {
  const decorators: DecoratorNode[] = [];
  while (ctx.cursor.at(TokenId.L_BRACKET)) {
    decorators.push(parseDecorator(ctx));
  }
  return decorators;
}

export function parseDecorator(ctx: ParserContext): DecoratorNode {
  const left = ctx.cursor.advance();
  const name = ctx.parseName();
  const arguments_: DomainTypeNode[] = [];
  const commaTokenIndices: number[] = [];
  let right: CursorToken | undefined;

  ctx.withErrorFence(() => {
    while (!ctx.cursor.at(TokenId.R_BRACKET) && !ctx.cursor.at(TokenId.EOF)) {
      const argument = parseDomainType(ctx);
      if (argument) {
        arguments_.push(argument);
      } else {
        break;
      }
      if (!ctx.cursor.at(TokenId.COMMA)) break;
      commaTokenIndices.push(ctx.cursor.advance().index);
    }
    right = ctx.consume(TokenId.R_BRACKET, "expected-token", "Expected ']' after decorator.");
  });

  return {
    ...ctx.nodeSpan("decorator", left.index, ctx.lastTokenIndex(right ?? arguments_.at(-1) ?? name ?? left)),
    arguments: arguments_,
    commaTokenIndices,
    kind: "decorator",
    leftBracketTokenIndex: left.index,
    name,
    rightBracketTokenIndex: right?.index,
  };
}

/**
 * Parses any declaration allowed in a `.fcc` header file.
 */
export function parseHeaderDeclaration(
  ctx: ParserContext,
  decorators: readonly DecoratorNode[],
): HeaderDeclarationNode | undefined {
  switch (ctx.cursor.current().token.kind) {
    case TokenId.DEFINE:
      return parseDefine(ctx, decorators);
    case TokenId.ALIAS:
      return parseAlias(ctx, decorators);
    case TokenId.ENUM:
      return parseEnum(ctx, decorators);
    case TokenId.TUPLE:
      return parseAggregate(ctx, decorators, "tuple-declaration");
    case TokenId.COMPONENT:
      return parseAggregate(ctx, decorators, "component-declaration");
    case TokenId.FUNC:
    case TokenId.ASYNC:
      return parseFunction(ctx, decorators, false);
    case TokenId.EVENT:
      return parseEvent(ctx, decorators, false);
    case TokenId.DECLARE:
      return parseDeclareGraph(ctx);
    default:
      return undefined;
  }
}

export function parseDefine(
  ctx: ParserContext,
  decorators: readonly DecoratorNode[],
): DefineDeclarationNode {
  const define = ctx.cursor.advance();
  const name = ctx.parseName();
  const colon = ctx.cursor.at(TokenId.COLON) ? ctx.cursor.advance() : undefined;
  const equals = !colon && ctx.cursor.at(TokenId.ASSIGN) ? ctx.cursor.advance() : undefined;
  if (!colon && !equals) {
    ctx.report("expected-token", "Expected ':' or '=' after define name.", ctx.cursor.current().token.range);
  }
  const type = parseDomainType(ctx);
  return {
    ...ctx.nodeSpan(
      "define-declaration",
      define.index,
      ctx.lastTokenIndex(type ?? equals ?? colon ?? name ?? define),
    ),
    colonTokenIndex: colon?.index,
    decorators,
    defineTokenIndex: define.index,
    equalsTokenIndex: equals?.index,
    kind: "define-declaration",
    name,
    type,
  };
}

export function parseAlias(
  ctx: ParserContext,
  decorators: readonly DecoratorNode[],
): AliasDeclarationNode {
  const alias = ctx.cursor.advance();
  const name = ctx.parseName();
  const equals = ctx.consume(TokenId.ASSIGN, "expected-token", "Expected '=' after alias name.");
  const type = parseTypeCombination(ctx);
  return {
    ...ctx.nodeSpan(
      "alias-declaration",
      alias.index,
      ctx.lastTokenIndex(type ?? equals ?? name ?? alias),
    ),
    decorators,
    equalsTokenIndex: equals?.index,
    kind: "alias-declaration",
    name,
    type,
  };
}

export function parseTypeCombination(
  ctx: ParserContext,
): TypeCombinationNode | DomainTypeNode | undefined {
  let left: TypeCombinationNode | DomainTypeNode | undefined = parseDomainType(ctx);
  if (!left) return undefined;
  while (ctx.cursor.at(TokenId.AND) || ctx.cursor.at(TokenId.OR)) {
    const operator = ctx.cursor.advance();
    const right = parseDomainType(ctx);
    const previous: TypeCombinationNode | DomainTypeNode = left;
    left = {
      ...ctx.nodeSpan(
        "type-combination",
        previous.tokenRange.start,
        ctx.lastTokenIndex(right ?? operator),
      ),
      kind: "type-combination",
      left,
      operator: operator.token.kind as TokenKind,
      operatorTokenIndex: operator.index,
      right,
    };
  }
  return left;
}

export function parseEnum(
  ctx: ParserContext,
  decorators: readonly DecoratorNode[],
): EnumDeclarationNode {
  const enumToken = ctx.cursor.advance();
  const name = ctx.parseName();
  const left = ctx.consume(TokenId.L_CURLY, "expected-token", "Expected '{' after enum name.");
  const members: EnumMemberNode[] = [];

  while (!ctx.cursor.at(TokenId.R_CURLY) && !ctx.cursor.at(TokenId.EOF)) {
    const memberDecorators = parseDecorators(ctx);
    const start = ctx.cursor.current();
    const memberName = ctx.parseName();
    const assign = ctx.cursor.at(TokenId.ASSIGN) ? ctx.cursor.advance() : undefined;
    const value = assign ? parseExpression(ctx, 0, false, true) : undefined;
    if (!memberName) {
      ctx.recover("Expected an enum member.", ENUM_MEMBER_SYNC);
      continue;
    }
    members.push({
      ...ctx.nodeSpan("enum-member", start.index, ctx.lastTokenIndex(value ?? assign ?? memberName)),
      assignTokenIndex: assign?.index,
      decorators: memberDecorators,
      kind: "enum-member",
      name: memberName,
      value,
    });
    ctx.consumeOptionalSemi();
  }

  const right = ctx.consume(TokenId.R_CURLY, "expected-token", "Expected '}' after enum body.");
  return {
    ...ctx.nodeSpan(
      "enum-declaration",
      enumToken.index,
      ctx.lastTokenIndex(right ?? members.at(-1) ?? left ?? name ?? enumToken),
    ),
    decorators,
    enumTokenIndex: enumToken.index,
    kind: "enum-declaration",
    leftCurlyTokenIndex: left?.index,
    members,
    name,
    rightCurlyTokenIndex: right?.index,
  };
}

export function parseAggregate(
  ctx: ParserContext,
  decorators: readonly DecoratorNode[],
  kind: AggregateDeclarationNode["kind"],
): AggregateDeclarationNode {
  const keyword = ctx.cursor.advance();
  const name = ctx.parseName();
  const left = ctx.consume(TokenId.L_CURLY, "expected-token", "Expected '{' after declaration name.");
  const fields: FieldDeclarationNode[] = [];

  while (!ctx.cursor.at(TokenId.R_CURLY) && !ctx.cursor.at(TokenId.EOF)) {
    const field = parseField(ctx, parseDecorators(ctx));
    if (field) {
      fields.push(field);
    } else {
      ctx.recover("Expected a field declaration.", AGGREGATE_FIELD_SYNC);
    }
    ctx.consumeOptionalSemi();
  }

  const right = ctx.consume(TokenId.R_CURLY, "expected-token", "Expected '}' after declaration body.");
  return {
    ...ctx.nodeSpan(
      kind,
      keyword.index,
      ctx.lastTokenIndex(right ?? fields.at(-1) ?? left ?? name ?? keyword),
    ),
    decorators,
    fields,
    kind,
    keywordTokenIndex: keyword.index,
    leftCurlyTokenIndex: left?.index,
    name,
    rightCurlyTokenIndex: right?.index,
  };
}

export function parseFunction(
  ctx: ParserContext,
  decorators: readonly DecoratorNode[],
  withBody: boolean,
): FunctionDeclarationNode {
  const asyncToken = ctx.cursor.at(TokenId.ASYNC) ? ctx.cursor.advance() : undefined;
  const func = ctx.consume(TokenId.FUNC, "expected-token", "Expected 'func'.");
  const name = ctx.parseName();
  const signature = parseSignature(ctx);
  const result = !asyncToken && ctx.isTypeStart() ? parseDomainType(ctx) : undefined;
  if (asyncToken && ctx.isTypeStart()) {
    ctx.report(
      "unexpected-token",
      "Async functions cannot declare a result type.",
      ctx.cursor.current().token.range,
    );
  }
  const body = withBody && ctx.cursor.at(TokenId.L_CURLY) ? parseBlock(ctx) : undefined;
  const start = asyncToken?.index ?? func?.index ?? name?.tokenIndex ?? ctx.cursor.current().index;
  return {
    ...ctx.nodeSpan(
      "function-declaration",
      start,
      ctx.lastTokenIndex(body ?? result ?? signature ?? name ?? func ?? asyncToken ?? ctx.cursor.current()),
    ),
    asyncTokenIndex: asyncToken?.index,
    body,
    decorators,
    funcTokenIndex: func?.index ?? start,
    kind: "function-declaration",
    name,
    result,
    signature,
  };
}

export function parseEvent(
  ctx: ParserContext,
  decorators: readonly DecoratorNode[],
  withBody: boolean,
): EventDeclarationNode {
  const event = ctx.cursor.advance();
  const name = parseQualifiedName(ctx);
  const signature = parseSignature(ctx);
  const body = withBody && ctx.cursor.at(TokenId.L_CURLY) ? parseBlock(ctx) : undefined;
  return {
    ...ctx.nodeSpan(
      "event-declaration",
      event.index,
      ctx.lastTokenIndex(body ?? signature ?? name ?? event),
    ),
    body,
    decorators,
    eventTokenIndex: event.index,
    kind: "event-declaration",
    name,
    signature,
  };
}

export function parseSignature(ctx: ParserContext): SignatureNode | undefined {
  if (!ctx.cursor.at(TokenId.L_PAREN)) {
    ctx.report("expected-token", "Expected '(' before parameters.", ctx.cursor.current().token.range);
    return undefined;
  }
  const left = ctx.cursor.advance();
  const parameters: ParameterNode[] = [];
  const commas: number[] = [];
  let trailingCommaTokenIndex: number | undefined;
  let right: CursorToken | undefined;

  ctx.withErrorFence(() => {
    while (!ctx.cursor.at(TokenId.R_PAREN) && !ctx.cursor.at(TokenId.EOF)) {
      const start = ctx.cursor.current();
      const out = ctx.cursor.at(TokenId.OUT) ? ctx.cursor.advance() : undefined;
      const varToken = out ? ctx.consume(TokenId.VAR, "expected-token", "Expected 'var' after 'out'.") : undefined;
      const name = ctx.parseName();
      const type = parseDomainType(ctx);
      if (!name || !type) break;
      parameters.push({
        ...ctx.nodeSpan("parameter", start.index, ctx.lastTokenIndex(type)),
        kind: "parameter",
        name,
        outTokenIndex: out?.index,
        type,
        varTokenIndex: varToken?.index,
      });
      if (!ctx.cursor.at(TokenId.COMMA)) break;
      const comma = ctx.cursor.advance();
      commas.push(comma.index);
      if (ctx.cursor.at(TokenId.R_PAREN)) {
        trailingCommaTokenIndex = comma.index;
        break;
      }
    }
    right = ctx.consume(TokenId.R_PAREN, "expected-token", "Expected ')' after parameters.");
  });

  return {
    ...ctx.nodeSpan("signature", left.index, ctx.lastTokenIndex(right ?? parameters.at(-1) ?? left)),
    commaTokenIndices: commas,
    kind: "signature",
    leftParenTokenIndex: left.index,
    parameters,
    rightParenTokenIndex: right?.index,
    trailingCommaTokenIndex,
  };
}

export function parseDeclareGraph(ctx: ParserContext): DeclareGraphNode {
  const declare = ctx.cursor.advance();
  const graph = ctx.consume(TokenId.GRAPH, "expected-token", "Expected 'graph' after 'declare'.");
  const name = ctx.parseName();
  const left = ctx.consume(TokenId.L_CURLY, "expected-token", "Expected '{' after declare graph name.");
  const fields: FieldDeclarationNode[] = [];
  const functions: FunctionDeclarationNode[] = [];

  while (!ctx.cursor.at(TokenId.R_CURLY) && !ctx.cursor.at(TokenId.EOF)) {
    if (ctx.cursor.at(TokenId.FUNC)) {
      functions.push(parseFunction(ctx, [], false));
    } else {
      const field = parseField(ctx, []);
      if (field) {
        fields.push(field);
      } else {
        ctx.recover("Expected declare graph member.", DECLARE_GRAPH_MEMBER_SYNC);
      }
    }
    ctx.consumeOptionalSemi();
  }

  const right = ctx.consume(TokenId.R_CURLY, "expected-token", "Expected '}' after declare graph body.");
  return {
    ...ctx.nodeSpan(
      "declare-graph",
      declare.index,
      ctx.lastTokenIndex(right ?? functions.at(-1) ?? fields.at(-1) ?? left ?? name ?? graph ?? declare),
    ),
    declareTokenIndex: declare.index,
    fields,
    functions,
    graphTokenIndex: graph?.index,
    kind: "declare-graph",
    leftCurlyTokenIndex: left?.index,
    name,
    rightCurlyTokenIndex: right?.index,
  };
}

export function parseField(
  ctx: ParserContext,
  decorators: readonly DecoratorNode[],
): FieldDeclarationNode | undefined {
  const start = ctx.cursor.current();
  const name = ctx.parseName();
  if (!name) return undefined;
  const colon = ctx.cursor.at(TokenId.COLON) ? ctx.cursor.advance() : undefined;
  const type = ctx.isTypeStart() ? parseDomainType(ctx) : undefined;
  const assign = ctx.cursor.at(TokenId.ASSIGN) ? ctx.cursor.advance() : undefined;
  const value = assign ? parseExpression(ctx, 0, false, true) : undefined;
  return {
    ...ctx.nodeSpan(
      "field-declaration",
      start.index,
      ctx.lastTokenIndex(value ?? assign ?? type ?? colon ?? name),
    ),
    assignTokenIndex: assign?.index,
    colonTokenIndex: colon?.index,
    decorators,
    kind: "field-declaration",
    name,
    type,
    value,
  };
}

export function reportBodyDecorators(
  ctx: ParserContext,
  decorators: readonly DecoratorNode[],
  what: string,
): void {
  if (decorators.length === 0) return;
  ctx.report(
    "unexpected-decorator",
    `Decorators are not allowed on graph-body ${what}; only fields may carry decorators.`,
    ctx.cursor.current().token.range,
  );
}

export function parseGraphDeclaration(
  ctx: ParserContext,
  decorators: readonly DecoratorNode[],
): GraphDeclarationNode | undefined {
  const staticToken = ctx.cursor.at(TokenId.STATIC) ? ctx.cursor.advance() : undefined;
  const graph = ctx.consume(TokenId.GRAPH, "expected-token", "Expected 'graph'.");
  if (!graph) return undefined;
  const name = ctx.parseName();
  const left = ctx.consume(TokenId.L_CURLY, "expected-token", "Expected '{' after graph name.");
  const members: (FieldDeclarationNode | FunctionDeclarationNode | EventDeclarationNode)[] = [];

  while (!ctx.cursor.at(TokenId.R_CURLY) && !ctx.cursor.at(TokenId.EOF)) {
    const memberDecorators = parseDecorators(ctx);
    let member: FieldDeclarationNode | FunctionDeclarationNode | EventDeclarationNode | undefined;
    if (ctx.cursor.at(TokenId.FUNC) || ctx.cursor.at(TokenId.ASYNC)) {
      reportBodyDecorators(ctx, memberDecorators, "functions");
      member = parseFunction(ctx, memberDecorators, true);
    } else if (ctx.cursor.at(TokenId.EVENT)) {
      reportBodyDecorators(ctx, memberDecorators, "event listeners");
      member = parseEvent(ctx, memberDecorators, true);
    } else {
      member = parseField(ctx, memberDecorators);
    }
    if (member) {
      members.push(member);
    } else {
      ctx.recover("Expected a graph member.", GRAPH_MEMBER_SYNC);
    }
    ctx.consumeOptionalSemi();
  }

  const right = ctx.consume(TokenId.R_CURLY, "expected-token", "Expected '}' after graph body.");
  return {
    ...ctx.nodeSpan(
      "graph-declaration",
      staticToken?.index ?? graph.index,
      ctx.lastTokenIndex(right ?? members.at(-1) ?? left ?? name ?? graph),
    ),
    decorators,
    elements: undefined,
    graphTokenIndex: graph.index,
    kind: "graph-declaration",
    leftCurlyTokenIndex: left?.index,
    members,
    name,
    rightCurlyTokenIndex: right?.index,
    staticTokenIndex: staticToken?.index,
  };
}

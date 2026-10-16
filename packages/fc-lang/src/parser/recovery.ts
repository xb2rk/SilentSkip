/**
 * Parser recovery synchronization sets.
 *
 * Defines synchronization token sets used by the parser to cleanly recover
 * between broken constructs (declarations, statements, members) without cascading errors.
 *
 * @see GRAMMAR.md §13 (Error Recovery)
 */

import { TokenId } from "../grammar/token-vocabulary.generated.js";

/** Tokens that can start a `.fcc` header declaration or decorator. */
export const HEADER_DECL_SYNC: ReadonlySet<number> = new Set<number>([
  TokenId.DEFINE,
  TokenId.ALIAS,
  TokenId.ENUM,
  TokenId.TUPLE,
  TokenId.COMPONENT,
  TokenId.FUNC,
  TokenId.ASYNC,
  TokenId.EVENT,
  TokenId.DECLARE,
  TokenId.L_BRACKET,
]);

/** Tokens that can start a graph member or decorator in a `.fcg` file. */
export const GRAPH_MEMBER_SYNC: ReadonlySet<number> = new Set<number>([
  TokenId.FUNC,
  TokenId.ASYNC,
  TokenId.EVENT,
  TokenId.SEMI,
  TokenId.L_BRACKET,
]);

/** Tokens that can start a `declare graph` member. */
export const DECLARE_GRAPH_MEMBER_SYNC: ReadonlySet<number> = new Set<number>([
  TokenId.FUNC,
  TokenId.SEMI,
]);

/** Tokens that resync aggregate (struct/component) field definitions. */
export const AGGREGATE_FIELD_SYNC: ReadonlySet<number> = new Set<number>([
  TokenId.SEMI,
  TokenId.L_BRACKET,
]);

/** Tokens that resync enum member definitions. */
export const ENUM_MEMBER_SYNC: ReadonlySet<number> = new Set<number>([
  TokenId.SEMI,
  TokenId.L_BRACKET,
]);

/** Keywords and delimiters that start statements in a code block. */
export const BLOCK_STATEMENT_SYNC: ReadonlySet<number> = new Set<number>([
  TokenId.VAR,
  TokenId.IF,
  TokenId.WHILE,
  TokenId.FOR,
  TokenId.RETURN,
  TokenId.BREAK,
  TokenId.CONTINUE,
  TokenId.L_CURLY,
  TokenId.SEMI,
]);

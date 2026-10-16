/**
 * Expression syntax nodes for the FC grammar.
 *
 * @see GRAMMAR.md §8 (Expressions)
 */

import type { TokenId } from "../grammar/token-vocabulary.generated.js";
import type { NameNode, QualifiedNameNode, SyntaxNode } from "./core.js";
import type { DomainTypeNode } from "./types.js";

/**
 * Literal constant expression (numeric, string, boolean, nil, color).
 */
export interface LiteralExpressionNode extends SyntaxNode {
  readonly kind: "literal-expression";
  readonly literalKind:
    | "boolean"
    | "color"
    | "float"
    | "imaginary"
    | "integer"
    | "nil"
    | "raw-string"
    | "rune"
    | "string";
  readonly tokenIndex: number;
}

/**
 * Identifier reference expression.
 */
export interface NameExpressionNode extends SyntaxNode {
  readonly kind: "name-expression";
  readonly name: NameNode;
}

/**
 * Built-in entity reference keyword (`thisEntity` or `globalEntity`).
 */
export interface EntityReferenceExpressionNode extends SyntaxNode {
  readonly kind: "entity-reference-expression";
  readonly reference: "globalEntity" | "thisEntity";
  readonly tokenIndex: number;
}

/**
 * Expression wrapped in parentheses `(expr)`.
 */
export interface ParenthesizedExpressionNode extends SyntaxNode {
  readonly kind: "parenthesized-expression";
  readonly expression: ExpressionNode | undefined;
  readonly leftParenTokenIndex: number;
  readonly rightParenTokenIndex: number | undefined;
}

/**
 * Unary prefix or postfix expression (e.g. `-x`, `!flag`, `x++`).
 */
export interface UnaryExpressionNode extends SyntaxNode {
  readonly kind: "unary-expression";
  readonly operand: ExpressionNode | undefined;
  readonly operator: TokenId;
  readonly operatorTokenIndex: number;
}

/**
 * Binary operator expression (e.g. `a + b`, `x && y`, `a << b`).
 */
export interface BinaryExpressionNode extends SyntaxNode {
  readonly kind: "binary-expression";
  readonly left: ExpressionNode;
  readonly operator: TokenId;
  readonly operatorTokenIndices: readonly number[];
  readonly right: ExpressionNode | undefined;
}

/**
 * Type cast expression (e.g. `val as int`).
 */
export interface CastExpressionNode extends SyntaxNode {
  readonly kind: "cast-expression";
  readonly asTokenIndex: number;
  readonly expression: ExpressionNode;
  readonly type: DomainTypeNode | undefined;
}

/**
 * `out var x` argument in a function call.
 */
export interface OutVarArgumentNode extends SyntaxNode {
  readonly kind: "out-var-argument";
  readonly name: NameNode | undefined;
  readonly outTokenIndex: number;
  readonly varTokenIndex: number | undefined;
}

/**
 * Argument in a function call (expression or `out var`).
 */
export type CallArgumentNode = ExpressionNode | OutVarArgumentNode;

/**
 * Function invocation expression (e.g. `print("hello")`).
 */
export interface CallExpressionNode extends SyntaxNode {
  readonly kind: "call-expression";
  readonly arguments: readonly CallArgumentNode[];
  readonly callee: ExpressionNode;
  readonly commaTokenIndices: readonly number[];
  readonly leftParenTokenIndex: number;
  readonly rightParenTokenIndex: number | undefined;
  readonly trailingCommaTokenIndex: number | undefined;
}

/**
 * Prefixed async call expression (e.g. `start DoTask()` or `wait Sleep(100)`).
 */
export interface PrefixedCallExpressionNode extends SyntaxNode {
  readonly kind: "prefixed-call-expression";
  readonly call: CallExpressionNode | undefined;
  readonly prefix: "start" | "wait";
  readonly prefixTokenIndex: number;
  readonly target: ExpressionNode | undefined;
}

/**
 * Array or map indexing expression `obj[index]`.
 */
export interface IndexExpressionNode extends SyntaxNode {
  readonly kind: "index-expression";
  readonly index: ExpressionNode | undefined;
  readonly leftBracketTokenIndex: number;
  readonly object: ExpressionNode;
  readonly rightBracketTokenIndex: number | undefined;
}

/**
 * Member property or method access `obj.member`.
 */
export interface MemberExpressionNode extends SyntaxNode {
  readonly kind: "member-expression";
  readonly dotTokenIndex: number;
  readonly member: NameNode | undefined;
  readonly object: ExpressionNode;
}

/**
 * Generic member access `obj.<Type>`.
 */
export interface GenericAccessExpressionNode extends SyntaxNode {
  readonly kind: "generic-access-expression";
  readonly closeAngleTokenIndex: number;
  readonly object: ExpressionNode;
  readonly openAngleTokenIndex: number;
  readonly typeArgument: DomainTypeNode;
}

/**
 * Type introspection `typeof(T)`.
 */
export interface TypeofExpressionNode extends SyntaxNode {
  readonly kind: "typeof-expression";
  readonly leftParenTokenIndex: number | undefined;
  readonly rightParenTokenIndex: number | undefined;
  readonly type: DomainTypeNode | undefined;
  readonly typeofTokenIndex: number;
}

/**
 * Positional composite literal (e.g. `List<int>{ 1, 2, 3 }` or `Vector3{ 0, 1, 0 }`).
 */
export interface PositionalCompositeExpressionNode extends SyntaxNode {
  readonly kind: "positional-composite-expression";
  readonly commaTokenIndices: readonly number[];
  readonly entries: readonly ExpressionNode[];
  readonly leftCurlyTokenIndex: number;
  readonly rightCurlyTokenIndex: number | undefined;
  readonly trailingCommaTokenIndex: number | undefined;
  readonly type: DomainTypeNode | undefined;
}

/**
 * Single key-value entry in a Map composite literal.
 */
export interface MapCompositeEntryNode extends SyntaxNode {
  readonly kind: "map-composite-entry";
  readonly colonTokenIndex: number | undefined;
  readonly key: ExpressionNode | undefined;
  readonly value: ExpressionNode | undefined;
}

/**
 * Map composite literal (e.g. `Map<string, int>{ "a": 1, "b": 2 }`).
 */
export interface MapCompositeExpressionNode extends SyntaxNode {
  readonly kind: "map-composite-expression";
  readonly commaTokenIndices: readonly number[];
  readonly entries: readonly MapCompositeEntryNode[];
  readonly leftCurlyTokenIndex: number;
  readonly rightCurlyTokenIndex: number | undefined;
  readonly trailingCommaTokenIndex: number | undefined;
  readonly type: DomainTypeNode | undefined;
}

/**
 * Single field assignment in a Struct composite literal.
 */
export interface StructCompositeFieldNode extends SyntaxNode {
  readonly kind: "struct-composite-field";
  readonly assignTokenIndex: number | undefined;
  readonly name: NameNode | undefined;
  readonly value: ExpressionNode | undefined;
}

/**
 * Struct composite literal (e.g. `MyStruct{ field = 10, other = true }`).
 */
export interface StructCompositeExpressionNode extends SyntaxNode {
  readonly kind: "struct-composite-expression";
  readonly commaTokenIndices: readonly number[];
  readonly fields: readonly StructCompositeFieldNode[];
  readonly leftCurlyTokenIndex: number;
  readonly rightCurlyTokenIndex: number | undefined;
  readonly trailingCommaTokenIndex: number | undefined;
  readonly typeName: QualifiedNameNode;
}

/**
 * Localized string composite literal `LocString{ key, args... }`.
 */
export interface LocStringExpressionNode extends SyntaxNode {
  readonly kind: "loc-string-expression";
  readonly arguments: PositionalCompositeExpressionNode | undefined;
  readonly commaTokenIndex: number | undefined;
  readonly key: ExpressionNode | undefined;
  readonly leftCurlyTokenIndex: number | undefined;
  readonly locStringTokenIndex: number;
  readonly rightCurlyTokenIndex: number | undefined;
}

/**
 * Union of all composite expression types.
 */
export type CompositeExpressionNode =
  | PositionalCompositeExpressionNode
  | MapCompositeExpressionNode
  | StructCompositeExpressionNode
  | LocStringExpressionNode;

/**
 * Union of all valid expressions in the FC language.
 */
export type ExpressionNode =
  | LiteralExpressionNode
  | NameExpressionNode
  | EntityReferenceExpressionNode
  | ParenthesizedExpressionNode
  | UnaryExpressionNode
  | BinaryExpressionNode
  | CastExpressionNode
  | CallExpressionNode
  | PrefixedCallExpressionNode
  | IndexExpressionNode
  | MemberExpressionNode
  | GenericAccessExpressionNode
  | TypeofExpressionNode
  | PositionalCompositeExpressionNode
  | MapCompositeExpressionNode
  | StructCompositeExpressionNode
  | LocStringExpressionNode;

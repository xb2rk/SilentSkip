/**
 * Statement syntax nodes for the FC grammar.
 *
 * @see GRAMMAR.md §9 (Statements)
 */

import type { TokenId } from "../grammar/token-vocabulary.generated.js";
import type { NameNode, SyntaxNode } from "./core.js";
import type { ExpressionNode } from "./expressions.js";
import type { DomainTypeNode } from "./types.js";

/**
 * An expression evaluated as a statement (e.g. `DoSomething()`).
 */
export interface ExpressionStatementNode extends SyntaxNode {
  readonly kind: "expression-statement";
  readonly expression: ExpressionNode | undefined;
}

/**
 * Return statement (e.g. `return;` or `return value;`).
 */
export interface ReturnStatementNode extends SyntaxNode {
  readonly kind: "return-statement";
  readonly expression: ExpressionNode | undefined;
  readonly returnTokenIndex: number;
}

/**
 * Flow control statement (`break` or `continue`).
 */
export interface SimpleStatementNode extends SyntaxNode {
  readonly kind: "break-statement" | "continue-statement";
  readonly keywordTokenIndex: number;
}

/**
 * Variable declaration statement `var name [type] [= expr]`.
 */
export interface VariableStatementNode extends SyntaxNode {
  readonly kind: "variable-statement";
  readonly assignTokenIndex: number | undefined;
  readonly name: NameNode | undefined;
  readonly type: DomainTypeNode | undefined;
  readonly value: ExpressionNode | undefined;
  readonly varTokenIndex: number;
}

/**
 * Assignment or compound assignment (e.g. `a = b`, `count += 1`).
 */
export interface AssignmentStatementNode extends SyntaxNode {
  readonly kind: "assignment-statement";
  readonly left: ExpressionNode | undefined;
  readonly operator: TokenId;
  readonly operatorTokenIndex: number;
  readonly right: ExpressionNode | undefined;
}

/**
 * Braced block containing a list of statements `{ ... }`.
 */
export interface BlockNode extends SyntaxNode {
  readonly kind: "block";
  readonly leftCurlyTokenIndex: number;
  readonly rightCurlyTokenIndex: number | undefined;
  readonly statements: readonly StatementNode[];
}

/**
 * Conditional branch statement `if (cond) { ... } [else { ... }]`.
 */
export interface IfStatementNode extends SyntaxNode {
  readonly kind: "if-statement";
  readonly alternate: BlockNode | IfStatementNode | undefined;
  readonly condition: ExpressionNode | undefined;
  readonly consequent: BlockNode | undefined;
  readonly elseTokenIndex: number | undefined;
  readonly ifTokenIndex: number;
}

/**
 * While loop `while (cond) { ... }`.
 */
export interface WhileStatementNode extends SyntaxNode {
  readonly kind: "while-statement";
  readonly body: BlockNode | undefined;
  readonly condition: ExpressionNode | undefined;
  readonly whileTokenIndex: number;
}

/**
 * Indexed for loop `for (var i = 0, 10, 1) { ... }`.
 */
export interface ForIndexStatementNode extends SyntaxNode {
  readonly kind: "for-index-statement";
  readonly assignTokenIndex: number | undefined;
  readonly binding: NameNode | undefined;
  readonly body: BlockNode | undefined;
  readonly commaTokenIndices: readonly number[];
  readonly end: ExpressionNode | undefined;
  readonly forTokenIndex: number;
  readonly leftParenTokenIndex: number | undefined;
  readonly rightParenTokenIndex: number | undefined;
  readonly start: ExpressionNode | undefined;
  readonly step: ExpressionNode | undefined;
}

/**
 * Collection iteration for loop `for (k, v in collection) { ... }`.
 */
export interface ForRangeStatementNode extends SyntaxNode {
  readonly kind: "for-range-statement";
  readonly binding: NameNode | undefined;
  readonly body: BlockNode | undefined;
  readonly forTokenIndex: number;
  readonly inTokenIndex: number | undefined;
  readonly iterable: ExpressionNode | undefined;
  readonly keyBinding: NameNode | undefined;
  readonly leftParenTokenIndex: number | undefined;
  readonly rightParenTokenIndex: number | undefined;
}

/**
 * Compiler-accepted expression-header for loop.
 */
export interface ForExpressionStatementNode extends SyntaxNode {
  readonly kind: "for-expression-statement";
  readonly body: BlockNode | undefined;
  readonly expression: ExpressionNode | undefined;
  readonly forTokenIndex: number;
  readonly leftParenTokenIndex: number | undefined;
  readonly rightParenTokenIndex: number | undefined;
}

/**
 * Union of all for-loop statements.
 */
export type ForStatementNode =
  | ForIndexStatementNode
  | ForRangeStatementNode
  | ForExpressionStatementNode;

/**
 * Union of all statements in the FC language.
 */
export type StatementNode =
  | ExpressionStatementNode
  | ReturnStatementNode
  | SimpleStatementNode
  | VariableStatementNode
  | AssignmentStatementNode
  | BlockNode
  | IfStatementNode
  | WhileStatementNode
  | ForStatementNode;

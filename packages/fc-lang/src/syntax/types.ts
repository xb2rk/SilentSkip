/**
 * Type expression syntax nodes for the FC grammar.
 *
 * @see GRAMMAR.md §3 (Type System)
 */

import type { NameNode, SyntaxNode } from "./core.js";

/**
 * Scalar primitive or named type (e.g. `int`, `string`, `MyCustomType`).
 */
export interface ScalarTypeNode extends SyntaxNode {
  readonly kind: "scalar-type";
  readonly name: NameNode;
  readonly reserved: boolean;
}

/**
 * Generic type instantiation (e.g. `List<int>`, `Map<string, Vector3>`).
 */
export interface GenericTypeNode extends SyntaxNode {
  readonly kind: "generic-type";
  readonly arguments: readonly DomainTypeNode[];
  readonly closeAngleTokenIndex: number | undefined;
  readonly commaTokenIndices: readonly number[];
  readonly constructorName: NameNode;
  readonly openAngleTokenIndex: number | undefined;
}

/**
 * Parameter within a function type signature.
 */
export interface FunctionTypeParameterNode extends SyntaxNode {
  readonly kind: "function-type-parameter";
  readonly name: NameNode;
  readonly outTokenIndex: number | undefined;
  readonly type: DomainTypeNode;
  readonly varTokenIndex: number | undefined;
}

/**
 * First-class function type signature (e.g. `func(a: int): bool`).
 */
export interface FunctionTypeNode extends SyntaxNode {
  readonly kind: "function-type";
  readonly commaTokenIndices: readonly number[];
  readonly funcTokenIndex: number;
  readonly leftParenTokenIndex: number | undefined;
  readonly parameters: readonly FunctionTypeParameterNode[];
  readonly result: DomainTypeNode | undefined;
  readonly rightParenTokenIndex: number | undefined;
}

/**
 * The inner type core of a domain type.
 */
export type TypeCoreNode = ScalarTypeNode | GenericTypeNode | FunctionTypeNode;

/**
 * Domain-scoped type (e.g. `server.Player`, `client.UIWindow`, or unprefixed `int`).
 */
export interface DomainTypeNode extends SyntaxNode {
  readonly kind: "domain-type";
  readonly domain: NameNode | undefined;
  readonly dotTokenIndex: number | undefined;
  readonly type: TypeCoreNode;
}

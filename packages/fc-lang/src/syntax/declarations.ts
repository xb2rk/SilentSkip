/**
 * Top-level and member declaration syntax nodes for the FC grammar.
 *
 * @see GRAMMAR.md §4-7 (Declarations)
 */

import type { TokenId } from "../grammar/token-vocabulary.generated.js";
import type { NameNode, QualifiedNameNode, SyntaxNode } from "./core.js";
import type { ExpressionNode } from "./expressions.js";
import type { BlockNode } from "./statements.js";
import type { DomainTypeNode } from "./types.js";

/**
 * Decorator annotation `[DecorName(args...)]`.
 */
export interface DecoratorNode extends SyntaxNode {
  readonly kind: "decorator";
  readonly arguments: readonly DomainTypeNode[];
  readonly commaTokenIndices: readonly number[];
  readonly leftBracketTokenIndex: number;
  readonly name: NameNode | undefined;
  readonly rightBracketTokenIndex: number | undefined;
}

/**
 * Whole-library import `import "path" [as Alias]`.
 */
export interface LibraryImportNode extends SyntaxNode {
  readonly kind: "library-import";
  readonly alias: NameNode | undefined;
  readonly asTokenIndex: number | undefined;
  readonly importTokenIndex: number;
  readonly pathTokenIndex: number | undefined;
}

/**
 * Named import `import Symbol [as Alias] from "path"`.
 */
export interface NamedImportNode extends SyntaxNode {
  readonly kind: "named-import";
  readonly alias: NameNode | undefined;
  readonly asTokenIndex: number | undefined;
  readonly fromTokenIndex: number | undefined;
  readonly importTokenIndex: number;
  readonly imported: NameNode | undefined;
  readonly pathTokenIndex: number | undefined;
}

/**
 * Import statement (library or named).
 */
export type ImportNode = LibraryImportNode | NamedImportNode;

/**
 * Type combination binary expression in alias declarations `Type1 | Type2`.
 */
export interface TypeCombinationNode extends SyntaxNode {
  readonly kind: "type-combination";
  readonly left: DomainTypeNode | TypeCombinationNode;
  readonly operator: TokenId;
  readonly operatorTokenIndex: number;
  readonly right: DomainTypeNode | TypeCombinationNode | undefined;
}

/**
 * Struct or component field declaration `var name: Type [= value]`.
 */
export interface FieldDeclarationNode extends SyntaxNode {
  readonly kind: "field-declaration";
  readonly assignTokenIndex: number | undefined;
  readonly colonTokenIndex: number | undefined;
  readonly decorators: readonly DecoratorNode[];
  readonly name: NameNode | undefined;
  readonly type: DomainTypeNode | undefined;
  readonly value: ExpressionNode | undefined;
}

/**
 * Member in an enum declaration `MemberName [= value]`.
 */
export interface EnumMemberNode extends SyntaxNode {
  readonly kind: "enum-member";
  readonly assignTokenIndex: number | undefined;
  readonly decorators: readonly DecoratorNode[];
  readonly name: NameNode | undefined;
  readonly value: ExpressionNode | undefined;
}

/**
 * Formal parameter in a function or event signature `[out] [var] name: Type`.
 */
export interface ParameterNode extends SyntaxNode {
  readonly kind: "parameter";
  readonly name: NameNode | undefined;
  readonly outTokenIndex: number | undefined;
  readonly type: DomainTypeNode | undefined;
  readonly varTokenIndex: number | undefined;
}

/**
 * Parameter list signature `(param1, param2, ...)`.
 */
export interface SignatureNode extends SyntaxNode {
  readonly kind: "signature";
  readonly commaTokenIndices: readonly number[];
  readonly leftParenTokenIndex: number | undefined;
  readonly parameters: readonly ParameterNode[];
  readonly rightParenTokenIndex: number | undefined;
  readonly trailingCommaTokenIndex: number | undefined;
}

/**
 * Define constant declaration `define Name: Type [= value]`.
 */
export interface DefineDeclarationNode extends SyntaxNode {
  readonly kind: "define-declaration";
  readonly colonTokenIndex: number | undefined;
  readonly decorators: readonly DecoratorNode[];
  readonly defineTokenIndex: number;
  readonly equalsTokenIndex: number | undefined;
  readonly name: NameNode | undefined;
  readonly type: DomainTypeNode | undefined;
}

/**
 * Alias declaration `alias Name = Type`.
 */
export interface AliasDeclarationNode extends SyntaxNode {
  readonly kind: "alias-declaration";
  readonly decorators: readonly DecoratorNode[];
  readonly equalsTokenIndex: number | undefined;
  readonly name: NameNode | undefined;
  readonly type: TypeCombinationNode | DomainTypeNode | undefined;
}

/**
 * Enum declaration `enum Name { ... }`.
 */
export interface EnumDeclarationNode extends SyntaxNode {
  readonly kind: "enum-declaration";
  readonly decorators: readonly DecoratorNode[];
  readonly enumTokenIndex: number;
  readonly leftCurlyTokenIndex: number | undefined;
  readonly members: readonly EnumMemberNode[];
  readonly name: NameNode | undefined;
  readonly rightCurlyTokenIndex: number | undefined;
}

/**
 * Component or Tuple declaration `component Name { ... }` or `tuple Name { ... }`.
 */
export interface AggregateDeclarationNode extends SyntaxNode {
  readonly kind: "component-declaration" | "tuple-declaration";
  readonly decorators: readonly DecoratorNode[];
  readonly fields: readonly FieldDeclarationNode[];
  readonly keywordTokenIndex: number;
  readonly leftCurlyTokenIndex: number | undefined;
  readonly name: NameNode | undefined;
  readonly rightCurlyTokenIndex: number | undefined;
}

/**
 * Function declaration `[async] func Name(params...): ReturnType { ... }`.
 */
export interface FunctionDeclarationNode extends SyntaxNode {
  readonly kind: "function-declaration";
  readonly asyncTokenIndex: number | undefined;
  readonly body: BlockNode | undefined;
  readonly decorators: readonly DecoratorNode[];
  readonly funcTokenIndex: number;
  readonly name: NameNode | undefined;
  readonly result: DomainTypeNode | undefined;
  readonly signature: SignatureNode | undefined;
}

/**
 * Event declaration `event EventName(params...) { ... }`.
 */
export interface EventDeclarationNode extends SyntaxNode {
  readonly kind: "event-declaration";
  readonly body: BlockNode | undefined;
  readonly decorators: readonly DecoratorNode[];
  readonly eventTokenIndex: number;
  readonly name: QualifiedNameNode | undefined;
  readonly signature: SignatureNode | undefined;
}

/**
 * Declare graph declaration `declare graph Name { ... }`.
 */
export interface DeclareGraphNode extends SyntaxNode {
  readonly kind: "declare-graph";
  readonly declareTokenIndex: number;
  readonly fields: readonly FieldDeclarationNode[];
  readonly functions: readonly FunctionDeclarationNode[];
  readonly graphTokenIndex: number | undefined;
  readonly leftCurlyTokenIndex: number | undefined;
  readonly name: NameNode | undefined;
  readonly rightCurlyTokenIndex: number | undefined;
}

/**
 * Valid declarations inside a `.fcc` header file.
 */
export type HeaderDeclarationNode =
  | DefineDeclarationNode
  | AliasDeclarationNode
  | EnumDeclarationNode
  | AggregateDeclarationNode
  | FunctionDeclarationNode
  | EventDeclarationNode
  | DeclareGraphNode;

/**
 * Graph declaration inside a `.fcg` source file.
 */
export interface GraphDeclarationNode extends SyntaxNode {
  readonly kind: "graph-declaration";
  readonly decorators: readonly DecoratorNode[];
  readonly elements: readonly FieldDeclarationNode[] | undefined;
  readonly graphTokenIndex: number;
  readonly leftCurlyTokenIndex: number | undefined;
  readonly members: readonly (FieldDeclarationNode | FunctionDeclarationNode | EventDeclarationNode)[] | undefined;
  readonly name: NameNode | undefined;
  readonly rightCurlyTokenIndex: number | undefined;
  readonly staticTokenIndex: number | undefined;
}

/**
 * Root node for a `.fcc` header file.
 */
export interface HeaderFileNode extends SyntaxNode {
  readonly kind: "header-file";
  readonly declarations: readonly HeaderDeclarationNode[];
  readonly imports: readonly ImportNode[];
}

/**
 * Root node for a `.fcg` graph implementation file.
 */
export interface GraphFileNode extends SyntaxNode {
  readonly kind: "graph-file";
  readonly graph: GraphDeclarationNode | undefined;
  readonly imports: readonly ImportNode[];
}

/**
 * Root node of any parsed FC file.
 */
export type SourceFileNode = HeaderFileNode | GraphFileNode;

/**
 * Union of all top-level declaration nodes.
 */
export type DeclarationNode =
  | HeaderDeclarationNode
  | GraphDeclarationNode
  | ImportNode
  | FieldDeclarationNode
  | EnumMemberNode;

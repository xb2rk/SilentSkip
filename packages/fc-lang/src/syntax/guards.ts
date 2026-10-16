/**
 * Comprehensive user-defined type guards for AST nodes.
 *
 * Eliminates the need for unsafe `as { ... }` casts across the codebase.
 */

import type { NameNode, QualifiedNameNode, SyntaxNode } from "./core.js";
import type {
  AggregateDeclarationNode,
  AliasDeclarationNode,
  DeclarationNode,
  DeclareGraphNode,
  DefineDeclarationNode,
  DecoratorNode,
  EnumDeclarationNode,
  EnumMemberNode,
  EventDeclarationNode,
  FieldDeclarationNode,
  FunctionDeclarationNode,
  GraphDeclarationNode,
  GraphFileNode,
  HeaderDeclarationNode,
  HeaderFileNode,
  ImportNode,
  LibraryImportNode,
  NamedImportNode,
  ParameterNode,
  SignatureNode,
  SourceFileNode,
  TypeCombinationNode,
} from "./declarations.js";
import type {
  BinaryExpressionNode,
  CallArgumentNode,
  CallExpressionNode,
  CastExpressionNode,
  CompositeExpressionNode,
  EntityReferenceExpressionNode,
  ExpressionNode,
  GenericAccessExpressionNode,
  IndexExpressionNode,
  LiteralExpressionNode,
  LocStringExpressionNode,
  MapCompositeEntryNode,
  MapCompositeExpressionNode,
  MemberExpressionNode,
  NameExpressionNode,
  OutVarArgumentNode,
  ParenthesizedExpressionNode,
  PositionalCompositeExpressionNode,
  PrefixedCallExpressionNode,
  StructCompositeExpressionNode,
  StructCompositeFieldNode,
  TypeofExpressionNode,
  UnaryExpressionNode,
} from "./expressions.js";
import type {
  AssignmentStatementNode,
  BlockNode,
  ExpressionStatementNode,
  ForExpressionStatementNode,
  ForIndexStatementNode,
  ForRangeStatementNode,
  ForStatementNode,
  IfStatementNode,
  ReturnStatementNode,
  SimpleStatementNode,
  StatementNode,
  VariableStatementNode,
  WhileStatementNode,
} from "./statements.js";
import type {
  DomainTypeNode,
  FunctionTypeNode,
  FunctionTypeParameterNode,
  GenericTypeNode,
  ScalarTypeNode,
  TypeCoreNode,
} from "./types.js";

/**
 * Umbrella union of every concrete syntax node kind.
 */
export type AnySyntaxNode =
  | NameNode
  | QualifiedNameNode
  | DomainTypeNode
  | ScalarTypeNode
  | GenericTypeNode
  | FunctionTypeParameterNode
  | FunctionTypeNode
  | LiteralExpressionNode
  | NameExpressionNode
  | EntityReferenceExpressionNode
  | ParenthesizedExpressionNode
  | UnaryExpressionNode
  | BinaryExpressionNode
  | CastExpressionNode
  | OutVarArgumentNode
  | CallExpressionNode
  | PrefixedCallExpressionNode
  | IndexExpressionNode
  | MemberExpressionNode
  | GenericAccessExpressionNode
  | TypeofExpressionNode
  | PositionalCompositeExpressionNode
  | MapCompositeEntryNode
  | MapCompositeExpressionNode
  | StructCompositeFieldNode
  | StructCompositeExpressionNode
  | LocStringExpressionNode
  | DecoratorNode
  | LibraryImportNode
  | NamedImportNode
  | TypeCombinationNode
  | FieldDeclarationNode
  | EnumMemberNode
  | ParameterNode
  | SignatureNode
  | DefineDeclarationNode
  | AliasDeclarationNode
  | EnumDeclarationNode
  | AggregateDeclarationNode
  | FunctionDeclarationNode
  | EventDeclarationNode
  | DeclareGraphNode
  | ExpressionStatementNode
  | ReturnStatementNode
  | SimpleStatementNode
  | VariableStatementNode
  | AssignmentStatementNode
  | BlockNode
  | IfStatementNode
  | WhileStatementNode
  | ForIndexStatementNode
  | ForRangeStatementNode
  | ForExpressionStatementNode
  | GraphDeclarationNode
  | HeaderFileNode
  | GraphFileNode;

export function isSyntaxNodeValue(value: unknown): value is AnySyntaxNode {
  return !!value && typeof value === "object" && typeof (value as { readonly kind?: unknown }).kind === "string";
}

const COMPOSITE_EXPRESSION_KINDS = new Set([
  "positional-composite-expression",
  "map-composite-expression",
  "struct-composite-expression",
  "loc-string-expression",
]);

export function isCompositeExpression(node: SyntaxNode): node is CompositeExpressionNode {
  return COMPOSITE_EXPRESSION_KINDS.has(node.kind);
}

export function isCallExpression(node: SyntaxNode): node is CallExpressionNode {
  return node.kind === "call-expression";
}

export function isPrefixedCallExpression(node: SyntaxNode): node is PrefixedCallExpressionNode {
  return node.kind === "prefixed-call-expression";
}

export function isBinaryExpression(node: SyntaxNode): node is BinaryExpressionNode {
  return node.kind === "binary-expression";
}

export function isUnaryExpression(node: SyntaxNode): node is UnaryExpressionNode {
  return node.kind === "unary-expression";
}

export function isBlockNode(node: SyntaxNode): node is BlockNode {
  return node.kind === "block";
}

export function isIfStatement(node: SyntaxNode): node is IfStatementNode {
  return node.kind === "if-statement";
}

export function isWhileStatement(node: SyntaxNode): node is WhileStatementNode {
  return node.kind === "while-statement";
}

export function isForStatement(node: SyntaxNode): node is ForStatementNode {
  return (
    node.kind === "for-index-statement" ||
    node.kind === "for-range-statement" ||
    node.kind === "for-expression-statement"
  );
}

export function isVariableStatement(node: SyntaxNode): node is VariableStatementNode {
  return node.kind === "variable-statement";
}

export function isAssignmentStatement(node: SyntaxNode): node is AssignmentStatementNode {
  return node.kind === "assignment-statement";
}

export function isReturnStatement(node: SyntaxNode): node is ReturnStatementNode {
  return node.kind === "return-statement";
}

export function isHeaderFile(node: SyntaxNode): node is HeaderFileNode {
  return node.kind === "header-file";
}

export function isGraphFile(node: SyntaxNode): node is GraphFileNode {
  return node.kind === "graph-file";
}

export function isSourceFile(node: SyntaxNode): node is SourceFileNode {
  return node.kind === "header-file" || node.kind === "graph-file";
}

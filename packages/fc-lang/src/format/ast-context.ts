/**
 * Traverses the parsed FC AST to tag significant tokens with formatting roles.
 *
 * @see GRAMMAR.md
 */

import { TokenId } from "../grammar/token-vocabulary.generated.js";
import type { Token } from "../lex/token.js";
import type { AnySyntaxNode, SyntaxNode } from "../syntax/index.js";
import type { BinaryExpressionNode, ExpressionNode, ParenthesizedExpressionNode } from "../syntax/expressions.js";
import { astChildren } from "../syntax/visitor.js";

export type CallFamily = "bare" | "value";

export interface LogicalHeader {
  readonly firstIndex: number;
  readonly lastIndex: number;
  readonly operatorOffsets: readonly number[];
}

const COMPOSITE_NODE_KINDS = new Set([
  "positional-composite-expression",
  "map-composite-expression",
  "struct-composite-expression",
  "loc-string-expression",
]);

const BLOCK_NODE_KINDS = new Set([
  "block",
  "graph-declaration",
  "tuple-declaration",
  "component-declaration",
  "enum-declaration",
  "declare-graph",
]);

/**
 * Semantic context mapped from the AST for precise formatting decisions.
 */
export class AstFormattingContext {
  public readonly blocks = new Set<number>();
  public readonly composites = new Set<number>();
  public readonly locStrings = new Set<number>();
  public readonly genericOpens = new Set<number>();
  public readonly genericCloses = new Set<number>();
  public readonly genericCommas = new Set<number>();
  public readonly unaryOperators = new Set<number>();
  public readonly shiftLeadingTokens = new Set<number>();
  public readonly shiftTrailingTokens = new Set<number>();
  public readonly indexOpens = new Set<number>();
  public readonly decoratorOpens = new Set<number>();
  public readonly elseAfterBlockCloses = new Set<number>();
  public readonly callFamilies = new Map<number, CallFamily>();
  public readonly funcTypeParens = new Set<number>();
  public readonly callTrailingCommas = new Set<number>();
  public readonly compositeTrailingCommas = new Set<number>();
  public readonly matchingClose = new Map<number, number>();
  public readonly headerConditionTokens = new Set<number>();
  public readonly logicalHeadersByStart = new Map<number, LogicalHeader>();

  public constructor(
    private readonly tokens: readonly Token[],
    private readonly significant: readonly Token[],
    root: AnySyntaxNode,
    private readonly significantIndexByOffset: ReadonlyMap<number, number>,
    private readonly significantIndexByEndOffset: ReadonlyMap<number, number>,
  ) {
    this.collect(root);
    this.collectCallFamilies(root, "value");
    this.collectMatchingDelimiters();
  }

  private collect(node: AnySyntaxNode | readonly AnySyntaxNode[]): void {
    if (Array.isArray(node)) {
      for (const item of node) this.collect(item);
      return;
    }
    const n = node as AnySyntaxNode;
    const kind = n.kind;

    if ("leftCurlyTokenIndex" in n) {
      const open = n.leftCurlyTokenIndex;
      if (typeof open === "number") {
        const token = this.tokens[open];
        if (token && COMPOSITE_NODE_KINDS.has(kind)) this.composites.add(token.range.start.offset);
        if (token && BLOCK_NODE_KINDS.has(kind)) this.blocks.add(token.range.start.offset);
        if (token && kind === "loc-string-expression") this.locStrings.add(token.range.start.offset);
      }
    }

    if ("trailingCommaTokenIndex" in n && COMPOSITE_NODE_KINDS.has(kind)) {
      const trailingComma = this.tokenAt(n.trailingCommaTokenIndex);
      if (trailingComma) this.compositeTrailingCommas.add(trailingComma.range.start.offset);
    }

    if ("closeAngleTokenIndex" in n) {
      const close = this.tokenAt(n.closeAngleTokenIndex);
      if (close) this.genericCloses.add(close.range.start.offset);
    }

    if ("openAngleTokenIndex" in n) {
      const genericOpen = this.tokenAt(n.openAngleTokenIndex);
      if (genericOpen) this.genericOpens.add(genericOpen.range.start.offset);
    }

    if (kind === "generic-type") {
      for (const commaTokenIndex of n.commaTokenIndices) {
        const token = this.tokens[commaTokenIndex];
        if (token) this.genericCommas.add(token.range.start.offset);
      }
    }

    if (kind === "unary-expression") {
      const operator = this.tokens[n.operatorTokenIndex];
      if (operator) this.unaryOperators.add(operator.range.start.offset);
    }

    if (kind === "binary-expression" && n.operatorTokenIndices.length === 2) {
      const [firstIndex, secondIndex] = n.operatorTokenIndices;
      const first = typeof firstIndex === "number" ? this.tokens[firstIndex] : undefined;
      const second = typeof secondIndex === "number" ? this.tokens[secondIndex] : undefined;
      if (
        first &&
        second &&
        first.kind === second.kind &&
        (first.kind === TokenId.LESS || first.kind === TokenId.GREATER)
      ) {
        this.shiftLeadingTokens.add(first.range.start.offset);
        this.shiftTrailingTokens.add(second.range.start.offset);
      }
    }

    if (kind === "index-expression" || kind === "decorator") {
      const leftBracket = this.tokens[n.leftBracketTokenIndex];
      if (leftBracket) {
        (kind === "index-expression" ? this.indexOpens : this.decoratorOpens).add(leftBracket.range.start.offset);
      }
    }

    if (kind === "function-type") {
      const leftParen = this.tokenAt(n.leftParenTokenIndex);
      if (leftParen) this.funcTypeParens.add(leftParen.range.start.offset);
    }

    if (kind === "if-statement" && typeof n.elseTokenIndex === "number") {
      const rightCurlyTokenIndex = n.consequent?.rightCurlyTokenIndex;
      const rightCurly = typeof rightCurlyTokenIndex === "number" ? this.tokens[rightCurlyTokenIndex] : undefined;
      if (rightCurly) this.elseAfterBlockCloses.add(rightCurly.range.start.offset);
    }

    if (kind === "if-statement" || kind === "while-statement") {
      this.collectHeaderConditionTokens(n.condition);
      this.collectLogicalHeader(n.condition);
    }

    for (const child of astChildren(n)) {
      this.collect(child);
    }
  }

  private collectHeaderConditionTokens(node: ExpressionNode | undefined): void {
    if (!node) return;
    const startOffset = node.range.start.offset;
    const endOffset = node.range.end.offset;
    const firstIndex = this.significantIndexByOffset.get(startOffset);
    const lastIndex = this.significantIndexByEndOffset.get(endOffset);
    if (firstIndex === undefined || lastIndex === undefined) return;
    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const token = this.significant[index];
      if (token) this.headerConditionTokens.add(token.range.start.offset);
    }
  }

  private collectLogicalHeader(condition: ExpressionNode | undefined): void {
    if (!condition) return;
    const startOffset = condition.range.start.offset;
    const endOffset = condition.range.end.offset;
    const firstIndex = this.significantIndexByOffset.get(startOffset);
    const lastIndex = this.significantIndexByEndOffset.get(endOffset);
    if (firstIndex === undefined || lastIndex === undefined) return;
    const operatorOffsets = this.directLogicalOperatorOffsets(condition, true);
    if (operatorOffsets.length) {
      const firstToken = this.significant[firstIndex];
      if (firstToken) {
        this.logicalHeadersByStart.set(firstToken.range.start.offset, {
          firstIndex,
          lastIndex,
          operatorOffsets,
        });
      }
    }
  }

  private directLogicalOperatorOffsets(value: ExpressionNode | undefined, root = false): number[] {
    if (!value) return [];
    if (value.kind === "parenthesized-expression") {
      return root ? this.directLogicalOperatorOffsets((value as ParenthesizedExpressionNode).expression) : [];
    }
    if (value.kind !== "binary-expression") return [];
    const bin = value as BinaryExpressionNode;
    if (bin.operator !== TokenId.LOGICAL_AND && bin.operator !== TokenId.LOGICAL_OR) return [];
    const offsets: number[] = [];
    for (const tokenIndex of bin.operatorTokenIndices) {
      const token = this.tokens[tokenIndex];
      if (token) offsets.push(token.range.start.offset);
    }
    return [
      ...this.directLogicalOperatorOffsets(bin.left),
      ...offsets,
      ...this.directLogicalOperatorOffsets(bin.right),
    ];
  }

  private collectCallFamilies(value: AnySyntaxNode | readonly AnySyntaxNode[] | undefined, family: CallFamily): void {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) this.collectCallFamilies(item, family);
      return;
    }
    const node = value as AnySyntaxNode;
    const kind = node.kind;

    if (kind === "expression-statement") {
      const expression = (node as { expression?: ExpressionNode }).expression;
      const expressionKind = expression?.kind ?? "";
      this.collectCallFamilies(
        expression,
        expressionKind === "call-expression" || expressionKind === "prefixed-call-expression" ? "bare" : "value",
      );
      return;
    }

    if (kind === "return-statement" || kind === "variable-statement") {
      this.collectCallFamilies(
        (node as { expression?: ExpressionNode; value?: ExpressionNode }).expression ??
          (node as { value?: ExpressionNode }).value,
        "value",
      );
      return;
    }

    if (kind === "assignment-statement") {
      this.collectCallFamilies((node as { left?: ExpressionNode }).left, "value");
      this.collectCallFamilies((node as { right?: ExpressionNode }).right, "value");
      return;
    }

    if (kind === "call-expression") {
      const callNode = node as {
        leftParenTokenIndex?: number;
        trailingCommaTokenIndex?: number;
        callee?: ExpressionNode;
        arguments?: readonly AnySyntaxNode[];
      };
      const leftParenTokenIndex = callNode.leftParenTokenIndex;
      const leftParen = typeof leftParenTokenIndex === "number" ? this.tokens[leftParenTokenIndex] : undefined;
      if (leftParen) {
        this.callFamilies.set(leftParen.range.start.offset, family);
        const trailingCommaTokenIndex = callNode.trailingCommaTokenIndex;
        const trailingComma =
          typeof trailingCommaTokenIndex === "number" ? this.tokens[trailingCommaTokenIndex] : undefined;
        if (trailingComma) this.callTrailingCommas.add(trailingComma.range.start.offset);
      }
      this.collectCallFamilies(callNode.callee, "value");
      this.collectCallFamilies(callNode.arguments, "value");
      return;
    }

    if (kind === "prefixed-call-expression") {
      this.collectCallFamilies((node as { call?: AnySyntaxNode }).call, family);
      return;
    }

    for (const child of astChildren(node)) {
      this.collectCallFamilies(child, family);
    }
  }

  private collectMatchingDelimiters(): void {
    const stack: { kind: TokenId; offset: number }[] = [];
    const opens = new Set<number>([TokenId.L_PAREN, TokenId.L_BRACKET, TokenId.L_CURLY]);
    const closes = new Map<number, number>([
      [TokenId.R_PAREN, TokenId.L_PAREN],
      [TokenId.R_BRACKET, TokenId.L_BRACKET],
      [TokenId.R_CURLY, TokenId.L_CURLY],
    ]);

    for (const token of this.significant) {
      if (opens.has(token.kind)) {
        stack.push({ kind: token.kind as TokenId, offset: token.range.start.offset });
        continue;
      }
      const openingKind = closes.get(token.kind);
      if (openingKind === undefined) continue;
      const top = stack.at(-1);
      if (top?.kind !== openingKind) continue;
      stack.pop();
      this.matchingClose.set(top.offset, token.range.start.offset);
    }
  }

  private tokenAt(index: unknown): Token | undefined {
    return typeof index === "number" ? this.tokens[index] : undefined;
  }
}

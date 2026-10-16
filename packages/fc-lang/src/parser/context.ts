/**
 * Parser context managing token cursors, diagnostic collection,
 * span calculations, error fences, and recovery synchronization.
 */

import { TokenId } from "../grammar/token-vocabulary.generated.js";
import type { SourceRange } from "../lex/position.js";
import type { Token } from "../lex/token.js";
import type { NameNode, SyntaxNode } from "../syntax/core.js";
import { ParserCursor, type CursorToken } from "./cursor.js";
export type { CursorToken } from "./cursor.js";
import type { ParseDiagnostic, ParseDiagnosticCode } from "./diagnostic.js";

export interface ParseResult<TNode> {
  readonly consumedThroughEof: boolean;
  readonly diagnostics: readonly ParseDiagnostic[];
  readonly node: TNode | undefined;
}

export const GENERAL_IDENTIFIER_KINDS = new Set<number>([
  TokenId.ELEMENT,
  TokenId.FROM,
  TokenId.TYPE,
  TokenId.COLOR,
  TokenId.LIST,
  TokenId.MAP,
  TokenId.ENTITY,
  TokenId.IDENTIFIER,
]);

export const RESERVED_SCALAR_TYPE_KINDS = new Set<number>([
  TokenId.OBJECT,
  TokenId.BOOL,
  TokenId.INT,
  TokenId.INT64,
  TokenId.FLOAT,
  TokenId.STRING,
  TokenId.VECTOR2,
  TokenId.VECTOR3,
  TokenId.QUATERNION,
  TokenId.LOC_STRING,
  TokenId.STRUCT,
  TokenId.EXPORT,
]);

export const TYPE_LIKE_EXPRESSION_NAME_IDS = new Set<number>([
  TokenId.VECTOR2,
  TokenId.VECTOR3,
  TokenId.QUATERNION,
  TokenId.LOC_STRING,
]);

export interface ErrorFenceState {
  readonly depth: number;
  readonly offsets: Set<number> | undefined;
  readonly size: number;
}

/**
 * Shared context for recursive-descent parsing.
 */
export class ParserContext {
  public readonly cursor: ParserCursor;
  public readonly diagnostics: ParseDiagnostic[] = [];
  private errorFenceDepth = 0;
  private errorFencedOffsets: Set<number> | undefined;

  public constructor(public readonly tokens: readonly Token[]) {
    this.cursor = new ParserCursor(tokens);
  }

  /**
   * Runs an operation with the error fence raised, suppressing duplicate diagnostics
   * at the same source offset to prevent cascading error noise.
   */
  public withErrorFence<T>(fn: () => T): T {
    this.errorFenceDepth += 1;
    try {
      return fn();
    } finally {
      this.errorFenceDepth -= 1;
      if (this.errorFenceDepth === 0) {
        this.errorFencedOffsets = undefined;
      }
    }
  }

  public saveErrorFence(): ErrorFenceState {
    return {
      depth: this.errorFenceDepth,
      offsets: this.errorFencedOffsets,
      size: this.errorFencedOffsets?.size ?? 0,
    };
  }

  public restoreErrorFence(saved: ErrorFenceState): void {
    this.errorFenceDepth = saved.depth;
    const current = this.errorFencedOffsets;
    if (current !== undefined && current === saved.offsets && current.size > saved.size) {
      for (const offset of [...current].slice(saved.size)) {
        current.delete(offset);
      }
    } else if (current !== saved.offsets) {
      this.errorFencedOffsets = saved.offsets;
    }
  }

  public tokenAt(index: number): Token {
    const token = this.tokens[index];
    if (!token) {
      throw new Error(`Missing token at index ${index}.`);
    }
    return token;
  }

  public nodeSpan<TKind extends string>(
    kind: TKind,
    start: number,
    end: number,
  ): Pick<SyntaxNode, "range" | "tokenRange"> & { readonly kind: TKind } {
    const startToken = this.tokenAt(start);
    const endToken = this.tokenAt(end);
    return {
      kind,
      range: { start: startToken.range.start, end: endToken.range.end },
      tokenRange: { start, end: end + 1 },
    };
  }

  public lastTokenIndex(node: SyntaxNode | CursorToken): number {
    return "token" in node ? node.index : node.tokenRange.end - 1;
  }

  public report(code: ParseDiagnosticCode, message: string, range: SourceRange): void {
    if (this.errorFenceDepth > 0) {
      let fenced = this.errorFencedOffsets;
      if (!fenced) {
        fenced = new Set<number>();
        this.errorFencedOffsets = fenced;
      }
      const offset = range.start.offset;
      if (fenced.has(offset)) {
        return;
      }
      fenced.add(offset);
    }
    this.diagnostics.push({ code, message, range });
  }

  public consume(kind: number, code: ParseDiagnosticCode, message: string): CursorToken | undefined {
    if (this.cursor.at(kind)) {
      return this.cursor.advance();
    }
    this.report(code, message, this.cursor.current().token.range);
    return undefined;
  }

  public consumeOptionalSemi(): void {
    if (this.cursor.at(TokenId.SEMI)) {
      this.cursor.advance();
    }
  }

  public isGeneralIdentifier(): boolean {
    return GENERAL_IDENTIFIER_KINDS.has(this.cursor.current().token.kind);
  }

  public isExpressionName(): boolean {
    return (
      this.isGeneralIdentifier() ||
      TYPE_LIKE_EXPRESSION_NAME_IDS.has(this.cursor.current().token.kind)
    );
  }

  public isTypeStart(): boolean {
    const kind = this.cursor.current().token.kind;
    return (
      RESERVED_SCALAR_TYPE_KINDS.has(kind) ||
      kind === TokenId.LIST ||
      kind === TokenId.MAP ||
      kind === TokenId.ENTITY ||
      kind === TokenId.FUNC ||
      GENERAL_IDENTIFIER_KINDS.has(kind)
    );
  }

  public atStructCompositeStart(): boolean {
    if (!this.isGeneralIdentifier()) {
      return false;
    }
    let offset = 1;
    while (this.cursor.peek(offset).token.kind === TokenId.DOT) {
      if (!GENERAL_IDENTIFIER_KINDS.has(this.cursor.peek(offset + 1).token.kind)) {
        return false;
      }
      offset += 2;
    }
    return this.cursor.peek(offset).token.kind === TokenId.L_CURLY;
  }

  public nameFrom(token: CursorToken): NameNode {
    return {
      ...this.nodeSpan("name", token.index, token.index),
      kind: "name",
      text: token.token.text,
      tokenIndex: token.index,
    };
  }

  public parseName(): NameNode | undefined {
    if (!this.isGeneralIdentifier()) {
      this.report(
        "expected-name",
        "Expected an FC identifier-like name.",
        this.cursor.current().token.range,
      );
      return undefined;
    }
    return this.nameFrom(this.cursor.advance());
  }

  public recover(message: string, sync?: ReadonlySet<number>): void {
    if (this.cursor.at(TokenId.EOF)) {
      return;
    }
    const token = this.cursor.current();
    this.report(
      "unexpected-token",
      `${message} Found ${JSON.stringify(token.token.text)}.`,
      token.token.range,
    );
    if (token.token.kind === TokenId.R_CURLY) {
      return;
    }
    this.cursor.advance();
    if (sync === undefined) {
      return;
    }

    let curlyDepth = 0;
    let groupDepth = 0;
    while (!this.cursor.at(TokenId.EOF)) {
      const kind = this.cursor.current().token.kind;
      if (kind === TokenId.R_CURLY && curlyDepth === 0) {
        return;
      }
      if (curlyDepth === 0 && sync.has(kind)) {
        return;
      }
      if (kind === TokenId.L_CURLY) {
        curlyDepth += 1;
      } else if (kind === TokenId.R_CURLY) {
        curlyDepth -= 1;
      } else if (kind === TokenId.L_PAREN || kind === TokenId.L_BRACKET) {
        groupDepth += 1;
      } else if (kind === TokenId.R_PAREN || kind === TokenId.R_BRACKET) {
        if (groupDepth === 0) {
          return;
        }
        groupDepth -= 1;
      }
      this.cursor.advance();
    }
  }

  public reportTrailingInput(): void {
    while (!this.cursor.at(TokenId.EOF)) {
      const current = this.cursor.advance();
      this.report(
        "unexpected-token",
        `Unexpected token ${JSON.stringify(current.token.text)} after complete parse.`,
        current.token.range,
      );
    }
  }

  public result<TNode>(node: TNode | undefined): ParseResult<TNode> {
    return {
      consumedThroughEof: this.cursor.at(TokenId.EOF),
      diagnostics: this.diagnostics,
      node,
    };
  }
}

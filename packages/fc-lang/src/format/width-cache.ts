/**
 * Bottom-up flat-width calculator and delimiter-pair cache with O(1) nested jump.
 *
 * @see README.md §Performance
 */

import { TokenId } from "../grammar/token-vocabulary.generated.js";
import type { Token } from "../lex/token.js";
import type { SyntaxNode } from "../syntax/core.js";
import type { AstFormattingContext } from "./ast-context.js";
import type { ResolvedFormatOptions } from "./options.js";

export type InlineTokenWriterFn = (
  token: Token,
  previous: Token | undefined,
  previousOffset: number,
  writer: {
    trim(): void;
    space(): void;
    write(val: string): void;
  },
) => void;

export class WidthCalculator {
  private readonly flatSuffixWidths = new Map<number, number>();
  private readonly pairInnerWidths = new Map<
    number,
    { readonly innerWidth: number; readonly closeIndex: number }
  >();

  public constructor(
    private readonly significant: readonly Token[],
    private readonly significantIndexByOffset: ReadonlyMap<number, number>,
    private readonly significantIndexByEndOffset: ReadonlyMap<number, number>,
    private readonly astContext: AstFormattingContext,
    private readonly options: ResolvedFormatOptions,
    private readonly writeInlineTokenFn: InlineTokenWriterFn,
    private readonly isCommentTokenFn: (token: Token) => boolean,
  ) {
    this.precomputePairInnerWidths();
  }

  /**
   * Calculates the flat width of an AST node.
   */
  public flatNodeWidth(node: SyntaxNode | undefined): number {
    if (!node) return Number.POSITIVE_INFINITY;
    const firstIndex = this.significantIndexByOffset.get(node.range.start.offset);
    const lastIndex = this.significantIndexByEndOffset.get(node.range.end.offset);
    if (firstIndex === undefined || lastIndex === undefined) return Number.POSITIVE_INFINITY;
    return this.flatRangeWidth(firstIndex, lastIndex);
  }

  /**
   * Retrieves or computes the remaining suffix width from an opening delimiter to its matching close.
   */
  public flatSuffixWidth(openOffset: number): number {
    const cached = this.flatSuffixWidths.get(openOffset);
    if (cached !== undefined) return cached;
    const closeOffset = this.astContext.matchingClose.get(openOffset);
    const openIndex = this.significantIndexByOffset.get(openOffset);
    const closeIndex = closeOffset === undefined ? undefined : this.significantIndexByOffset.get(closeOffset);
    if (openIndex === undefined || closeIndex === undefined) return Number.POSITIVE_INFINITY;
    const width = this.flatRangeWidth(openIndex + 1, closeIndex);
    this.flatSuffixWidths.set(openOffset, width);
    return width;
  }

  /**
   * Simulates inline formatted rendering across a range of significant tokens to measure its print width.
   */
  public flatRangeWidth(
    firstIndex: number,
    lastIndex: number,
    initialPrevious?: Token,
    initialText = "",
  ): number {
    let flat = initialText;
    let extra = 0;
    let previous = initialPrevious;
    let previousOffset = initialPrevious?.range.start.offset ?? -1;

    const trim = (): void => {
      flat = flat.replace(/[ \t]+$/u, "");
    };
    const space = (): void => {
      if (flat && !flat.endsWith(" ")) flat += " ";
    };
    const write = (value: string): void => {
      flat += value;
    };
    const appendWordOrOperator = (token: Token): void => {
      this.writeInlineTokenFn(token, previous, previousOffset, { trim, space, write });
    };

    for (let index = firstIndex; index <= lastIndex; index += 1) {
      const token = this.significant[index];
      if (!token) continue;

      if (
        this.astContext.callTrailingCommas.has(token.range.start.offset) ||
        this.astContext.compositeTrailingCommas.has(token.range.start.offset)
      ) {
        continue;
      }

      if (this.isCommentTokenFn(token)) {
        if (
          token.text.includes("\n") ||
          token.kind === TokenId.LINE_COMMENT ||
          token.kind === TokenId.LINE_COMMENT_NLSEMI
        ) {
          return Number.POSITIVE_INFINITY;
        }
        space();
        write(token.text);
        previous = token;
        previousOffset = token.range.start.offset;
        continue;
      }

      switch (token.kind) {
        case TokenId.L_PAREN: {
          if (this.groupNeedsLeadingSpace(previous, token)) space();
          else trim();
          write("(");
          const skip = this.trySkipPair(token);
          if (skip) {
            if (!Number.isFinite(skip.innerWidth)) return Number.POSITIVE_INFINITY;
            extra += skip.innerWidth;
            previous = skip.close;
            previousOffset = skip.close.range.start.offset;
            index = skip.closeIndex;
          }
          break;
        }
        case TokenId.R_PAREN:
          trim();
          write(")");
          break;
        case TokenId.L_BRACKET: {
          trim();
          write("[");
          const skip = this.trySkipPair(token);
          if (skip) {
            if (!Number.isFinite(skip.innerWidth)) return Number.POSITIVE_INFINITY;
            extra += skip.innerWidth;
            previous = skip.close;
            previousOffset = skip.close.range.start.offset;
            index = skip.closeIndex;
          }
          break;
        }
        case TokenId.R_BRACKET:
          trim();
          write("]");
          break;
        case TokenId.L_CURLY: {
          if (this.groupNeedsLeadingSpace(previous, token)) {
            space();
            write("{");
          } else {
            trim();
            write("{");
          }
          const skip = this.trySkipPair(token);
          if (skip) {
            if (!Number.isFinite(skip.innerWidth)) return Number.POSITIVE_INFINITY;
            extra += skip.innerWidth;
            previous = skip.close;
            previousOffset = skip.close.range.start.offset;
            index = skip.closeIndex;
          }
          break;
        }
        case TokenId.R_CURLY:
          trim();
          write("}");
          break;
        case TokenId.COMMA:
          trim();
          write(",");
          if (this.options.spaceAfterComma) write(" ");
          break;
        case TokenId.DOT:
          trim();
          write(".");
          break;
        case TokenId.COLON:
          trim();
          write(": ");
          break;
        case TokenId.LESS:
          if (this.astContext.genericOpens.has(token.range.start.offset)) {
            trim();
            write("<");
          } else if (this.astContext.shiftLeadingTokens.has(token.range.start.offset)) {
            trim();
            if (this.options.spaceAroundOperators) space();
            write("<<");
            if (this.options.spaceAroundOperators) write(" ");
          } else if (!this.astContext.shiftTrailingTokens.has(token.range.start.offset)) {
            appendWordOrOperator(token);
          }
          break;
        case TokenId.GREATER:
          if (this.astContext.genericCloses.has(token.range.start.offset)) {
            trim();
            write(">");
          } else if (this.astContext.shiftLeadingTokens.has(token.range.start.offset)) {
            trim();
            if (this.options.spaceAroundOperators) space();
            write(">>");
            if (this.options.spaceAroundOperators) write(" ");
          } else if (!this.astContext.shiftTrailingTokens.has(token.range.start.offset)) {
            appendWordOrOperator(token);
          }
          break;
        default:
          appendWordOrOperator(token);
          break;
      }
      previous = token;
      previousOffset = token.range.start.offset;
    }
    trim();
    return flat.length + extra;
  }

  private groupNeedsLeadingSpace(previous: Token | undefined, token: Token): boolean {
    if (this.astContext.funcTypeParens.has(token.range.start.offset)) return false;
    if (token.kind === TokenId.L_CURLY && this.astContext.blocks.has(token.range.start.offset)) return true;
    if (!previous) return false;
    if (previous.kind === TokenId.COMMA) return this.options.spaceAfterComma;
    if (this.requiresTrailingSpace(previous.kind)) return true;
    return (
      !this.astContext.genericCloses.has(previous.range.start.offset) &&
      this.isOperator(previous.kind) &&
      !this.astContext.unaryOperators.has(previous.range.start.offset)
        ? this.options.spaceAroundOperators
        : false
    );
  }

  private requiresTrailingSpace(kind: number): boolean {
    return (
      [
        TokenId.IF,
        TokenId.ELSE,
        TokenId.FOR,
        TokenId.WHILE,
        TokenId.RETURN,
        TokenId.VAR,
        TokenId.FUNC,
        TokenId.EVENT,
        TokenId.GRAPH,
        TokenId.STATIC,
        TokenId.ASYNC,
        TokenId.WAIT,
        TokenId.START,
        TokenId.AS,
        TokenId.IN,
        TokenId.OUT,
        TokenId.IMPORT,
        TokenId.FROM,
        TokenId.DEFINE,
        TokenId.ALIAS,
        TokenId.ENUM,
        TokenId.TUPLE,
        TokenId.COMPONENT,
        TokenId.DECLARE,
      ] as number[]
    ).includes(kind);
  }

  private isOperator(kind: number): boolean {
    return (
      [
        TokenId.PLUS_PLUS,
        TokenId.MINUS_MINUS,
        TokenId.DECLARE_ASSIGN,
        TokenId.LOGICAL_OR,
        TokenId.LOGICAL_AND,
        TokenId.EQUALS,
        TokenId.NOT_EQUALS,
        TokenId.LESS,
        TokenId.LESS_OR_EQUALS,
        TokenId.GREATER,
        TokenId.GREATER_OR_EQUALS,
        TokenId.ASSIGN,
        TokenId.PLUS_ASSIGN,
        TokenId.MINUS_ASSIGN,
        TokenId.STAR_ASSIGN,
        TokenId.DIV_ASSIGN,
        TokenId.MOD_ASSIGN,
        TokenId.AND_ASSIGN,
        TokenId.XOR_ASSIGN,
        TokenId.OR_ASSIGN,
        TokenId.RSHIFT_ASSIGN,
        TokenId.LSHIFT_ASSIGN,
        TokenId.OR,
        TokenId.DIV,
        TokenId.MOD,
        TokenId.AND,
        TokenId.XOR,
        TokenId.EXCLAMATION,
        TokenId.BIT_NOT,
        TokenId.PLUS,
        TokenId.MINUS,
        TokenId.STAR,
      ] as number[]
    ).includes(kind);
  }

  private precomputePairInnerWidths(): void {
    const pairs: {
      readonly openOffset: number;
      readonly openIndex: number;
      readonly closeIndex: number;
    }[] = [];
    for (const [openOffset, closeOffset] of this.astContext.matchingClose) {
      const openIndex = this.significantIndexByOffset.get(openOffset);
      const closeIndex = this.significantIndexByOffset.get(closeOffset);
      if (openIndex === undefined || closeIndex === undefined) continue;
      pairs.push({ openOffset, openIndex, closeIndex });
    }
    pairs.sort((a, b) => b.openIndex - a.openIndex);
    for (const pair of pairs) {
      const open = this.significant[pair.openIndex];
      if (!open) continue;
      const rendered = this.flatRangeWidth(pair.openIndex + 1, pair.closeIndex, open, "(");
      const innerWidth = Number.isFinite(rendered) ? rendered - 1 : rendered;
      this.pairInnerWidths.set(pair.openOffset, { innerWidth, closeIndex: pair.closeIndex });
      this.flatSuffixWidths.set(pair.openOffset, innerWidth);
    }
  }

  private trySkipPair(
    open: Token,
  ): { readonly innerWidth: number; readonly close: Token; readonly closeIndex: number } | undefined {
    const cached = this.pairInnerWidths.get(open.range.start.offset);
    if (cached === undefined) return undefined;
    const close = this.significant[cached.closeIndex];
    if (!close) return undefined;
    return { innerWidth: cached.innerWidth, close, closeIndex: cached.closeIndex };
  }
}

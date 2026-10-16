/**
 * Full syntax-directed lossless token formatter for FC source code.
 *
 * @see ARCHITECTURE.md §Formatter
 */

import { TokenId } from "../grammar/token-vocabulary.generated.js";
import { sortHeaderImports } from "../imports/import-sorter.js";
import type { LexDiagnostic } from "../lex/diagnostic.js";
import { lex } from "../lex/lexer.js";
import type { Token } from "../lex/token.js";
import { containsLineBreak, isTrivia } from "../lex/trivia.js";
import type { ParseDiagnostic } from "../parser/diagnostic.js";
import { parseGraphFile, parseHeaderFile } from "../parser/file-parser.js";
import { walkAst, type AnySyntaxNode } from "../syntax/index.js";
import { AlignmentManager } from "./alignment.js";
import { AstFormattingContext } from "./ast-context.js";
import { resolveFormatOptions, type FormatOptions, type ResolvedFormatOptions } from "./options.js";
import { collectIgnoreRanges, type IgnoreRange } from "./pragmas.js";
import { TokenWriter } from "./token-writer.js";
import { WidthCalculator } from "./width-cache.js";

export type { FormatOptions } from "./options.js";

/** Formatter execution result report. */
export interface FormatResult {
  readonly code: string | undefined;
  readonly diagnostics: readonly (ParseDiagnostic | LexDiagnostic)[];
  readonly changed: boolean;
}

/** Formatter frame stack state for tracking nesting and indentation depth. */
interface Frame {
  kind: "paren" | "index" | "decorator" | "block" | "composite";
  broken: boolean;
  indent: number;
  parentIndent: number;
  bareCall: boolean;
  call: boolean;
  startColumn: number;
  nested: boolean;
  openOffset?: number;
}

/** Formats one validated `.fcc` or `.fcg` source string into canonical form. */
export function formatSource(source: string, options: FormatOptions = {}): FormatResult {
  const resolved = resolveFormatOptions(options);
  let input = source.replace(/^\uFEFF/u, "");
  let lexed = lex(input);
  if (lexed.diagnostics.length) {
    return { code: undefined, diagnostics: lexed.diagnostics, changed: false };
  }

  const isHeader =
    options.fileKind === "fcc" ||
    (options.fileKind === undefined && options.fileName?.toLowerCase().endsWith(".fcc"));

  let parsed = isHeader ? parseHeaderFile(lexed) : parseGraphFile(lexed);
  if (parsed.diagnostics.length || !parsed.node) {
    return { code: undefined, diagnostics: parsed.diagnostics, changed: false };
  }

  if (resolved.sortImports) {
    const normalizedImports = sortHeaderImports(input, lexed.tokens, parsed.node.imports);
    if (normalizedImports !== input) {
      input = normalizedImports;
      lexed = lex(input);
      if (lexed.diagnostics.length) {
        return { code: undefined, diagnostics: lexed.diagnostics, changed: false };
      }
      parsed = isHeader ? parseHeaderFile(lexed) : parseGraphFile(lexed);
      if (parsed.diagnostics.length || !parsed.node) {
        return { code: undefined, diagnostics: parsed.diagnostics, changed: false };
      }
    }
  }

  const code = new TokenFormatter(lexed.tokens, parsed.node, resolved, source).format();
  return { code, diagnostics: [], changed: code !== source };
}

/** Core token-level formatting state machine. */
export class TokenFormatter {
  private readonly significant: Token[];
  private readonly significantIndexByOffset = new Map<number, number>();
  private readonly significantIndexByEndOffset = new Map<number, number>();
  private readonly lineBreakBefore = new Map<number, number>();
  private readonly breakAllLogicalOperators = new Set<number>();
  private readonly frames: Frame[] = [];
  private readonly astContext: AstFormattingContext;
  private readonly alignment: AlignmentManager;
  private readonly widthCalculator: WidthCalculator;
  private readonly ignoreRanges: readonly IgnoreRange[];
  private readonly writer: TokenWriter;

  private previous: Token | undefined;
  private previousOffset = -1;
  private sourceBreak = false;
  private currentIndex = 0;

  public constructor(
    private readonly tokens: readonly Token[],
    root: AnySyntaxNode,
    private readonly options: ResolvedFormatOptions,
    private readonly originalSource: string,
  ) {
    this.significant = tokens.filter(
      (token) => (isCommentToken(token) || !isTrivia(token)) && token.kind !== TokenId.EOF,
    );
    this.significant.forEach((token, index) => {
      this.significantIndexByOffset.set(token.range.start.offset, index);
      this.significantIndexByEndOffset.set(token.range.end.offset, index);
    });

    let pendingBreaks = 0;
    for (const token of tokens) {
      if (isCommentToken(token)) {
        if (pendingBreaks) this.lineBreakBefore.set(token.range.start.offset, pendingBreaks);
        pendingBreaks = 0;
        continue;
      }
      if (isTrivia(token)) {
        pendingBreaks += (token.text.match(/\n/gu) ?? []).length;
        continue;
      }
      if (token.kind !== TokenId.EOF) {
        if (pendingBreaks) this.lineBreakBefore.set(token.range.start.offset, pendingBreaks);
        pendingBreaks = 0;
      }
    }

    this.astContext = new AstFormattingContext(
      tokens,
      this.significant,
      root,
      this.significantIndexByOffset,
      this.significantIndexByEndOffset,
    );

    this.widthCalculator = new WidthCalculator(
      this.significant,
      this.significantIndexByOffset,
      this.significantIndexByEndOffset,
      this.astContext,
      options,
      (t, p, po, w) => this.writeInlineToken(t, p, po, w),
      (t) => isCommentToken(t),
    );

    this.alignment = new AlignmentManager(options, tokens);
    walkAst(root, (node) => {
      if (
        node.kind === "map-composite-expression" ||
        node.kind === "struct-composite-expression"
      ) {
        this.alignment.collectComposite(node, (n) => this.widthCalculator.flatNodeWidth(n));
      }
    });

    this.ignoreRanges = collectIgnoreRanges(tokens);
    const detectedEol = originalSource.includes("\r\n") ? "\r\n" : "\n";
    this.writer = new TokenWriter(options, detectedEol);
  }

  /**
   * Executes the formatting algorithm and returns the formatted text.
   */
  public format(): string {
    for (let i = 0; i < this.significant.length; i++) {
      this.currentIndex = i;
      const token = this.significant[i];
      if (!token) continue;

      const ignore = this.ignoreRanges.find(
        (r) => token.range.start.offset >= r.startOffset && token.range.end.offset <= r.endOffset,
      );
      if (ignore) {
        this.emitVerbatimRange(token, ignore);
        // Skip ahead to token past ignore
        while (i + 1 < this.significant.length && this.significant[i + 1]!.range.end.offset <= ignore.endOffset) {
          i++;
        }
        continue;
      }

      this.emit(token);
    }

    return this.writer.finish();
  }

  private emitVerbatimRange(token: Token, range: IgnoreRange): void {
    const slice = this.originalSource.slice(token.range.start.offset, range.endOffset);
    this.writer.write(slice);
  }

  private emit(token: Token): void {
    const breakCount = this.lineBreakBefore.get(token.range.start.offset) ?? 0;
    const precedingCommentAlreadyEndedLine =
      breakCount === 1 && this.previous !== undefined && this.commentEndsLine(this.previous);
    this.sourceBreak = this.sourceBreak || (breakCount > 0 && !precedingCommentAlreadyEndedLine);
    if (breakCount > 1) {
      this.writer.sourceLineBreaks(breakCount, this.options.collapseBlankLines);
    }

    this.beginLogicalHeaderCondition(token);

    switch (token.kind) {
      case TokenId.LINE_COMMENT:
      case TokenId.LINE_COMMENT_NLSEMI:
        if (this.sourceBreak) this.writer.newline();
        this.writer.space();
        this.writer.write(token.text);
        this.writer.newline();
        break;

      case TokenId.COMMENT:
      case TokenId.COMMENT_NLSEMI:
        if (this.sourceBreak) this.writer.newline();
        this.writer.space();
        this.writer.write(token.text);
        if (containsLineBreak(token) || token.text.includes("\n")) this.writer.newline();
        break;

      case TokenId.L_CURLY:
        this.openCurly(token);
        break;

      case TokenId.R_CURLY:
        this.closeCurly(token);
        break;

      case TokenId.L_PAREN:
        if (
          this.sourceBreak &&
          !this.astContext.headerConditionTokens.has(token.range.start.offset) &&
          this.frames.at(-1)?.kind === "block"
        ) {
          this.writer.newline();
        }
        this.openParen(token);
        break;

      case TokenId.R_PAREN:
        this.closeParen();
        break;

      case TokenId.L_BRACKET:
        this.openBracket(token);
        break;

      case TokenId.R_BRACKET:
        this.pop("index", "decorator");
        this.writer.trim();
        this.writer.write("]");
        break;

      case TokenId.COMMA:
        this.comma(token);
        break;

      case TokenId.SEMI:
        this.writer.newline();
        break;

      case TokenId.DOT:
        this.writer.trim();
        this.writer.write(".");
        break;

      case TokenId.COLON:
        if (!this.writeAlignedCompositeSeparator(token, ": ")) {
          this.writer.trim();
          this.writer.write(": ");
        }
        break;

      case TokenId.ASSIGN:
        if (!this.writeAlignedCompositeSeparator(token, this.options.spaceAroundOperators ? " = " : "=")) {
          this.wordOrOperator(token);
        }
        break;

      case TokenId.LESS:
        if (this.astContext.genericOpens.has(token.range.start.offset)) {
          this.writer.trim();
          this.writer.write("<");
        } else if (this.astContext.shiftLeadingTokens.has(token.range.start.offset)) {
          this.shiftOperator(token);
        } else if (!this.astContext.shiftTrailingTokens.has(token.range.start.offset)) {
          this.wordOrOperator(token);
        }
        break;

      case TokenId.GREATER:
        if (this.astContext.genericCloses.has(token.range.start.offset)) {
          this.writer.trim();
          this.writer.write(">");
        } else if (this.astContext.shiftLeadingTokens.has(token.range.start.offset)) {
          this.shiftOperator(token);
        } else if (!this.astContext.shiftTrailingTokens.has(token.range.start.offset)) {
          this.wordOrOperator(token);
        }
        break;

      default:
        this.wordOrOperator(token);
        break;
    }

    this.previous = token;
    this.previousOffset = token.range.start.offset;
    this.sourceBreak = false;
  }

  private openCurly(token: Token): void {
    const block = this.astContext.blocks.has(token.range.start.offset);
    const composite = this.astContext.composites.has(token.range.start.offset);
    if (!block && !composite) {
      throw new Error(`Missing AST brace role at ${token.range.start.offset}.`);
    }

    if (block) {
      this.writer.space();
      this.writer.write("{");
      this.writer.newline();
      this.writer.indent += 1;
      this.frames.push({
        kind: "block",
        broken: false,
        indent: this.writer.indent,
        parentIndent: this.writer.indent - 1,
        bareCall: false,
        call: false,
        nested: false,
        startColumn: this.writer.column,
      });
    } else {
      const nested = this.hasBreakableFrame();
      const locString = this.astContext.locStrings.has(token.range.start.offset);
      if (this.groupNeedsLeadingSpace(this.previous, token)) {
        this.writer.space();
      } else {
        this.writer.trim();
      }
      this.writer.write("{");
      const frame: Frame = {
        kind: "composite",
        broken: false,
        indent: this.writer.activeLineIndent + 1,
        parentIndent: this.writer.indent,
        bareCall: false,
        call: false,
        nested,
        startColumn: this.writer.column,
        openOffset: token.range.start.offset,
      };
      this.frames.push(frame);

      if (!locString && this.shouldBreakCompositeAtOpen(frame, token.range.start.offset)) {
        frame.broken = true;
        this.writer.newline();
        this.writer.indent = frame.indent;
      } else if (this.options.bracketSpacing) {
        const nextToken = this.significant[this.currentIndex + 1];
        if (nextToken && nextToken.kind !== TokenId.R_CURLY) {
          this.writer.write(" ");
        }
      }
    }
  }

  private closeCurly(token: Token): void {
    const frame = this.pop("block", "composite");
    if (frame?.kind === "block") {
      if (!this.writer.lineStart) this.writer.newline();
      this.writer.indent = frame.parentIndent;
      this.writer.write("}");
      if (this.astContext.elseAfterBlockCloses.has(token.range.start.offset)) {
        this.writer.write(" ");
      } else {
        this.writer.newline();
      }
    } else {
      if (frame?.broken) {
        this.writer.trim();
        if (!this.writer.hasTrailingComma()) this.writer.write(",");
        this.writer.newline();
        this.writer.indent = frame.parentIndent;
        this.writer.trim();
      } else if (this.options.bracketSpacing && this.previous?.kind !== TokenId.L_CURLY) {
        this.writer.trim();
        this.writer.write(" ");
      } else {
        this.writer.trim();
      }
      this.writer.write("}");
    }
  }

  private openParen(token: Token): void {
    const nested = this.hasBreakableFrame();
    if (this.groupNeedsLeadingSpace(this.previous, token)) {
      this.writer.space();
    } else {
      this.writer.trim();
    }
    this.writer.write("(");
    const family = this.astContext.callFamilies.get(token.range.start.offset);
    const frame: Frame = {
      kind: "paren",
      broken: false,
      indent: this.writer.activeLineIndent + 1,
      parentIndent: this.writer.indent,
      bareCall: family === "bare",
      call: family !== undefined,
      nested,
      startColumn: this.writer.column,
    };
    this.frames.push(frame);
    if (frame.call && this.shouldBreakAtOpen(frame, token.range.start.offset)) {
      frame.broken = true;
      this.writer.newline();
      this.writer.indent = frame.indent;
    }
  }

  private openBracket(token: Token): void {
    if (
      this.sourceBreak &&
      this.previous?.kind === TokenId.R_BRACKET &&
      (this.frames.length === 0 || this.frames.at(-1)?.kind === "block")
    ) {
      this.writer.newline();
    }
    const kind = this.astContext.indexOpens.has(token.range.start.offset)
      ? "index"
      : this.astContext.decoratorOpens.has(token.range.start.offset)
        ? "decorator"
        : undefined;
    if (!kind) throw new Error(`Missing AST bracket role at ${token.range.start.offset}.`);
    const nested = this.hasBreakableFrame();
    this.writer.trim();
    this.writer.write("[");
    this.frames.push({
      kind,
      broken: false,
      indent: this.writer.activeLineIndent + 1,
      parentIndent: this.writer.indent,
      bareCall: false,
      call: false,
      nested,
      startColumn: this.writer.column,
    });
  }

  private closeParen(): void {
    const frame = this.pop("paren");
    if (frame?.broken && frame.bareCall) {
      this.writer.trim();
      if (!this.writer.hasTrailingComma()) this.writer.write(",");
      this.writer.newline();
      this.writer.indent = frame.parentIndent;
    }
    this.writer.trim();
    this.writer.write(")");
    if (frame) this.writer.indent = frame.parentIndent;
  }

  private comma(token: Token): void {
    if (
      this.astContext.callTrailingCommas.has(token.range.start.offset) ||
      this.astContext.compositeTrailingCommas.has(token.range.start.offset)
    ) {
      return;
    }
    if (this.astContext.genericCommas.has(token.range.start.offset)) {
      this.writer.trim();
      this.writer.write(",");
      if (this.options.spaceAfterComma) this.writer.write(" ");
      return;
    }
    this.writer.trim();
    this.writer.write(",");
    const frame = this.frames.at(-1);
    if (frame && (frame.kind === "paren" || frame.kind === "composite") && frame.broken) {
      this.writer.newline();
      this.writer.indent = frame.indent;
    } else if (this.options.spaceAfterComma) {
      this.writer.write(" ");
    }
  }

  private writeAlignedCompositeSeparator(token: Token, separator: string): boolean {
    const alignment = this.alignment.getAlignment(token.range.start.offset);
    const frame = this.frames.at(-1);
    if (
      !alignment ||
      frame?.kind !== "composite" ||
      !frame.broken ||
      frame.openOffset !== alignment.openOffset
    ) {
      return false;
    }
    this.writer.trim();
    const keyWidth = this.writer.column - this.writer.activeLineIndent * this.options.tabWidth;
    if (keyWidth < alignment.keyWidth) {
      this.writer.write(" ".repeat(alignment.keyWidth - keyWidth));
    }
    this.writer.write(separator);
    return true;
  }

  private wordOrOperator(token: Token): void {
    if (
      this.sourceBreak &&
      this.previous &&
      !this.astContext.headerConditionTokens.has(token.range.start.offset) &&
      (!this.isOperator(this.previous.kind) ||
        this.astContext.genericCloses.has(this.previous.range.start.offset) ||
        this.previous.kind === TokenId.PLUS_PLUS ||
        this.previous.kind === TokenId.MINUS_MINUS) &&
      (this.frames.length === 0 || this.frames.at(-1)?.kind === "block") &&
      !(token.kind === TokenId.ELSE && this.previous.kind === TokenId.R_CURLY)
    ) {
      this.writer.newline();
    }
    this.writeInlineToken(token, this.previous, this.previousOffset, {
      trim: () => this.writer.trim(),
      space: () => this.writer.space(),
      write: (val) => this.writer.write(val),
    });
    if (this.breakAllLogicalOperators.has(token.range.start.offset)) {
      this.writer.newlineAtIndent(this.writer.indent + 1);
    }
  }

  private shiftOperator(token: Token): void {
    if (
      this.sourceBreak &&
      this.previous &&
      !this.astContext.headerConditionTokens.has(token.range.start.offset) &&
      (!this.isOperator(this.previous.kind) ||
        this.astContext.genericCloses.has(this.previous.range.start.offset) ||
        this.previous.kind === TokenId.PLUS_PLUS ||
        this.previous.kind === TokenId.MINUS_MINUS) &&
      (this.frames.length === 0 || this.frames.at(-1)?.kind === "block")
    ) {
      this.writer.newline();
    }
    this.writer.trim();
    if (this.options.spaceAroundOperators) this.writer.space();
    this.writer.write(token.text + token.text);
    if (this.options.spaceAroundOperators) this.writer.write(" ");
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

  private isUnaryOperator(token: Token): boolean {
    return this.astContext.unaryOperators.has(token.range.start.offset);
  }

  private previousWasUnary(token: Token | undefined): boolean {
    return token !== undefined && this.isUnaryOperator(token);
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

  private needsSpaceBeforeUnary(previous: Token | undefined): boolean {
    if (!previous) return false;
    if (previous.kind === TokenId.COMMA) return this.options.spaceAfterComma;
    if (previous.kind === TokenId.COLON || this.requiresTrailingSpace(previous.kind)) return true;
    return !this.astContext.genericCloses.has(previous.range.start.offset) &&
      this.isOperator(previous.kind) &&
      !this.isUnaryOperator(previous)
      ? this.options.spaceAroundOperators
      : false;
  }

  public writeInlineToken(
    token: Token,
    previous: Token | undefined,
    previousOffset: number,
    writer: {
      trim(): void;
      space(): void;
      write(value: string): void;
    },
  ): void {
    if (this.isOperator(token.kind)) {
      if (this.isUnaryOperator(token)) {
        if (this.needsSpaceBeforeUnary(previous)) writer.space();
        else writer.trim();
        writer.write(token.text);
        return;
      }
      if (this.options.spaceAroundOperators) {
        writer.space();
        writer.write(token.text);
        writer.write(" ");
        return;
      }
      if (this.astContext.genericCloses.has(previousOffset) && token.text.startsWith("=")) {
        writer.space();
      } else {
        writer.trim();
      }
      writer.write(token.text);
      return;
    }

    if (this.wordNeedsLeadingSpace(previous)) writer.space();
    writer.write(token.text);
    if (this.requiresTrailingSpace(token.kind)) writer.write(" ");
  }

  private wordNeedsLeadingSpace(previous: Token | undefined): boolean {
    if (!previous) return false;
    if (previous.kind === TokenId.COMMA) return this.options.spaceAfterComma;
    return (
      !([TokenId.L_PAREN, TokenId.L_BRACKET, TokenId.L_CURLY, TokenId.DOT] as number[]).includes(
        previous.kind,
      ) &&
      !this.astContext.genericOpens.has(previous.range.start.offset) &&
      !this.previousWasUnary(previous) &&
      !this.isOperator(previous.kind)
    );
  }

  private beginLogicalHeaderCondition(token: Token): void {
    const header = this.astContext.logicalHeadersByStart.get(token.range.start.offset);
    if (!header) return;
    const conditionWidth = this.widthCalculator.flatRangeWidth(header.firstIndex, header.lastIndex);
    if (
      !Number.isFinite(conditionWidth) ||
      this.writer.column + conditionWidth + 2 > this.options.printWidth
    ) {
      for (const offset of header.operatorOffsets) {
        this.breakAllLogicalOperators.add(offset);
      }
    }
  }

  private hasBreakableFrame(): boolean {
    return this.frames.some((frame) => frame.kind === "paren" || frame.kind === "composite");
  }

  private commentEndsLine(token: Token): boolean {
    return (
      isCommentToken(token) &&
      (token.kind === TokenId.LINE_COMMENT ||
        token.kind === TokenId.LINE_COMMENT_NLSEMI ||
        containsLineBreak(token) ||
        token.text.includes("\n"))
    );
  }

  private groupNeedsLeadingSpace(previous: Token | undefined, token: Token): boolean {
    if (this.astContext.funcTypeParens.has(token.range.start.offset)) return false;
    if (token.kind === TokenId.L_CURLY && this.astContext.blocks.has(token.range.start.offset)) return true;
    return this.openingGroupNeedsLeadingSpace(previous);
  }

  private openingGroupNeedsLeadingSpace(previous: Token | undefined = this.previous): boolean {
    if (!previous) return false;
    if (previous.kind === TokenId.COMMA) return this.options.spaceAfterComma;
    if (this.requiresTrailingSpace(previous.kind)) return true;
    return !this.astContext.genericCloses.has(previous.range.start.offset) &&
      this.isOperator(previous.kind) &&
      !this.isUnaryOperator(previous)
      ? this.options.spaceAroundOperators
      : false;
  }

  private pop(...kinds: Frame["kind"][]): Frame | undefined {
    const frame = this.frames.at(-1);
    return frame && kinds.includes(frame.kind) ? this.frames.pop() : undefined;
  }

  private shouldBreakAtOpen(frame: Frame, openOffset: number): boolean {
    const mode = this.options.wrapCalls;
    if (mode === "never") return false;
    const suffixWidth = this.widthCalculator.flatSuffixWidth(openOffset);
    if (mode === "always") return suffixWidth > 1;
    if (!Number.isFinite(suffixWidth)) return true;
    if (suffixWidth <= 1) return false;
    return frame.nested
      ? suffixWidth > this.options.printWidth
      : this.writer.column + suffixWidth > this.options.printWidth;
  }

  private shouldBreakCompositeAtOpen(frame: Frame, openOffset: number): boolean {
    const mode = this.options.wrapCollections;
    if (mode === "never") return false;
    const suffixWidth = this.widthCalculator.flatSuffixWidth(openOffset);
    if (mode === "always") return suffixWidth > 1;
    if (!Number.isFinite(suffixWidth)) return true;
    if (suffixWidth <= 1) return false;
    return frame.nested
      ? suffixWidth > this.options.printWidth
      : this.writer.column + suffixWidth > this.options.printWidth;
  }
}

function isCommentToken(token: Token): boolean {
  return (
    token.kind === TokenId.COMMENT ||
    token.kind === TokenId.COMMENT_NLSEMI ||
    token.kind === TokenId.LINE_COMMENT ||
    token.kind === TokenId.LINE_COMMENT_NLSEMI
  );
}

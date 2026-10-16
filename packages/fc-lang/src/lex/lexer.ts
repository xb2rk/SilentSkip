/**
 * Lossless, source-preserving FC lexer.
 *
 * Scans FC source into exact tokens preserving all trivia (whitespace, line comments,
 * block comments, JSDoc). It never injects synthetic EOS tokens or alters source bytes.
 *
 * @see GRAMMAR.md §2 (Lexical Rules)
 */

import {
  isDecimalDigit,
  isHexDigit,
  isIdentifierContinue,
  isIdentifierStart,
  isWhitespaceCharacter,
  MULTI_CHARACTER_TOKEN_IDS,
  SINGLE_CHARACTER_TOKEN_IDS,
  tokenIdForKeyword,
  type LexicalTokenId,
} from "../grammar/lexical.js";
import { TokenId } from "../grammar/token-vocabulary.generated.js";
import type { LexDiagnostic, LexDiagnosticCode } from "./diagnostic.js";
import type { SourcePosition } from "./position.js";
import type { Token } from "./token.js";

/**
 * Result of lexing an FC source string.
 */
export interface LexResult {
  /** Any lexical diagnostics encountered during scanning. */
  readonly diagnostics: readonly LexDiagnostic[];
  /** The original source string. */
  readonly source: string;
  /** Complete, lossless stream of tokens covering the entire source string. */
  readonly tokens: readonly Token[];
}

interface NumericToken {
  readonly end: number;
  readonly kind: LexicalTokenId;
}

interface Mark {
  readonly offset: number;
  readonly position: SourcePosition;
}

/**
 * Lexes an FC source string into a lossless token stream.
 *
 * @param source - The raw FC source code to tokenize.
 * @returns Complete LexResult with tokens and any recoverable diagnostics.
 */
export function lex(source: string): LexResult {
  return new Scanner(source).scan();
}

/**
 * State machine scanner that advances character-by-character and emits tokens.
 */
class Scanner {
  private column = 0;
  private index = 0;
  private line = 0;
  private previousWasCarriageReturn = false;
  private readonly diagnostics: LexDiagnostic[] = [];
  private readonly tokens: Token[] = [];

  public constructor(private readonly source: string) {}

  public scan(): LexResult {
    while (this.index < this.source.length) {
      const start = this.mark();
      const character = this.characterAt(this.index);

      if (isWhitespaceCharacter(character)) {
        this.emit(TokenId.WS, start, this.scanWhitespace(this.index));
      } else if (this.startsWith("//")) {
        this.emit(TokenId.LINE_COMMENT, start, this.scanLineComment(this.index));
      } else if (this.startsWith("/*")) {
        this.scanBlockComment(start);
      } else if (character === '"') {
        this.scanQuoted(start, '"', TokenId.INTERPRETED_STRING_LIT, "unterminated-interpreted-string");
      } else if (character === "'") {
        this.scanQuoted(start, "'", TokenId.RUNE_LIT, "unterminated-rune");
      } else if (character === "`") {
        this.scanRawString(start);
      } else if (character === "#" && this.isColorLiteral(this.index)) {
        this.emit(TokenId.COLOR_HEX_LIT, start, this.scanColorLiteral(this.index));
      } else if (this.isNumberStart(this.index)) {
        const numeric = this.scanNumber(this.index);
        this.emit(numeric.kind, start, numeric.end);
      } else if (isIdentifierStart(character)) {
        const end = this.scanIdentifier(this.index);
        const text = this.source.slice(this.index, end);
        this.emit(tokenIdForKeyword(text) ?? TokenId.IDENTIFIER, start, end);
      } else {
        const multiCharacter = MULTI_CHARACTER_TOKEN_IDS.find(([text]) => this.startsWith(text));
        if (multiCharacter) {
          this.emit(multiCharacter[1], start, this.index + multiCharacter[0].length);
        } else {
          const singleCharacterKind = SINGLE_CHARACTER_TOKEN_IDS.get(character);
          if (singleCharacterKind !== undefined) {
            this.emit(singleCharacterKind, start, this.index + character.length);
          } else {
            const end = this.index + character.length;
            this.emit(TokenId.OTHER, start, end);
            this.addDiagnostic("unexpected-character", `Unexpected character ${JSON.stringify(character)}.`, start, this.positionAt(end));
          }
        }
      }
    }

    const eofPosition = this.position();
    this.tokens.push({
      kind: TokenId.EOF,
      range: { start: eofPosition, end: eofPosition },
      text: "",
    });

    return {
      diagnostics: this.diagnostics,
      source: this.source,
      tokens: this.tokens,
    };
  }

  private addDiagnostic(code: LexDiagnosticCode, message: string, start: Mark, end: SourcePosition): void {
    this.diagnostics.push({ code, message, range: { start: start.position, end } });
  }

  private characterAt(offset: number): string {
    const codePoint = this.source.codePointAt(offset);
    return codePoint === undefined ? "" : String.fromCodePoint(codePoint);
  }

  private emit(kind: LexicalTokenId, start: Mark, end: number): void {
    this.advanceTo(end);
    this.tokens.push({
      kind,
      range: { start: start.position, end: this.position() },
      text: this.source.slice(start.offset, end),
    });
  }

  private isColorLiteral(start: number): boolean {
    const remaining = this.source.slice(start + 1);
    const firstSix = remaining.slice(0, 6);
    if (firstSix.length !== 6 || ![...firstSix].every(isHexDigit)) {
      return false;
    }
    const seventh = remaining[6] ?? "";
    if (!isHexDigit(seventh)) {
      return true;
    }
    const alpha = remaining.slice(6, 8);
    return alpha.length === 2 && [...alpha].every(isHexDigit);
  }

  private isNumberStart(start: number): boolean {
    return (
      isDecimalDigit(this.characterAt(start)) ||
      (this.characterAt(start) === "." && isDecimalDigit(this.characterAt(start + 1)))
    );
  }

  private mark(): Mark {
    return { offset: this.index, position: this.position() };
  }

  private position(): SourcePosition {
    return { offset: this.index, line: this.line, column: this.column };
  }

  private positionAt(end: number): SourcePosition {
    const originalIndex = this.index;
    const originalLine = this.line;
    const originalColumn = this.column;
    const originalPreviousWasCarriageReturn = this.previousWasCarriageReturn;
    this.advanceTo(end);
    const position = this.position();
    this.index = originalIndex;
    this.line = originalLine;
    this.column = originalColumn;
    this.previousWasCarriageReturn = originalPreviousWasCarriageReturn;
    return position;
  }

  private scanBlockComment(start: Mark): void {
    let cursor = this.index + 2;
    while (cursor < this.source.length && !(this.source[cursor] === "*" && this.source[cursor + 1] === "/")) {
      cursor += this.characterAt(cursor).length;
    }

    if (cursor < this.source.length) {
      this.emit(TokenId.COMMENT, start, cursor + 2);
      return;
    }

    this.emit(TokenId.COMMENT, start, this.source.length);
    this.addDiagnostic(
      "unterminated-block-comment",
      "Unterminated block comment.",
      start,
      this.position(),
    );
  }

  private scanColorLiteral(start: number): number {
    const afterSix = start + 7;
    const alpha = this.source.slice(afterSix, afterSix + 2);
    return alpha.length === 2 && [...alpha].every(isHexDigit) ? afterSix + 2 : afterSix;
  }

  private scanDigitSequence(start: number, isDigit: (character: string) => boolean): number {
    let cursor = start;
    while (isDigit(this.characterAt(cursor))) {
      cursor += this.characterAt(cursor).length;
    }
    while (this.characterAt(cursor) === "_" && isDigit(this.characterAt(cursor + 1))) {
      cursor += 1 + this.characterAt(cursor + 1).length;
      while (isDigit(this.characterAt(cursor))) {
        cursor += this.characterAt(cursor).length;
      }
    }
    return cursor;
  }

  private scanExponent(start: number, marker: "e" | "E" | "p" | "P"): number | undefined {
    if (this.characterAt(start) !== marker) return undefined;
    let cursor = start + 1;
    if (this.characterAt(cursor) === "+" || this.characterAt(cursor) === "-") {
      cursor += 1;
    }
    if (!isDecimalDigit(this.characterAt(cursor))) {
      return undefined;
    }
    return this.scanDigitSequence(cursor, isDecimalDigit);
  }

  private scanIdentifier(start: number): number {
    let cursor = start + this.characterAt(start).length;
    while (isIdentifierContinue(this.characterAt(cursor))) {
      cursor += this.characterAt(cursor).length;
    }
    return cursor;
  }

  private scanLineComment(start: number): number {
    let cursor = start + 2;
    while (cursor < this.source.length) {
      const character = this.characterAt(cursor);
      if (character === "\r" || character === "\n") break;
      cursor += character.length;
    }
    return cursor;
  }

  private scanNumber(start: number): NumericToken {
    let cursor = start;
    const leadingDot = this.characterAt(cursor) === ".";

    if (!leadingDot && this.characterAt(cursor) === "0") {
      const prefix = this.characterAt(cursor + 1);
      if (prefix === "b" || prefix === "B") {
        return this.withImaginary(
          this.scanDigitSequence(cursor + 2, (char) => char === "0" || char === "1"),
          TokenId.BINARY_LIT,
        );
      }
      if (prefix === "o" || prefix === "O") {
        return this.withImaginary(
          this.scanDigitSequence(cursor + 2, (char) => char >= "0" && char <= "7"),
          TokenId.OCTAL_LIT,
        );
      }
      if (prefix === "x" || prefix === "X") {
        cursor = this.scanDigitSequence(cursor + 2, isHexDigit);
        let isFloat = false;
        if (this.characterAt(cursor) === ".") {
          isFloat = true;
          cursor = this.scanDigitSequence(cursor + 1, isHexDigit);
        }
        const exponent = this.scanExponent(cursor, "p") ?? this.scanExponent(cursor, "P");
        if (exponent !== undefined) {
          isFloat = true;
          cursor = exponent;
        }
        return this.withImaginary(cursor, isFloat ? TokenId.HEX_FLOAT_LIT : TokenId.HEX_LIT);
      }
    }

    let isFloat = leadingDot;
    if (leadingDot) {
      cursor = this.scanDigitSequence(cursor + 1, isDecimalDigit);
    } else {
      cursor = this.scanDigitSequence(cursor, isDecimalDigit);
      if (this.characterAt(cursor) === ".") {
        isFloat = true;
        cursor = this.scanDigitSequence(cursor + 1, isDecimalDigit);
      }
    }

    const exponent = this.scanExponent(cursor, "e") ?? this.scanExponent(cursor, "E");
    if (exponent !== undefined) {
      isFloat = true;
      cursor = exponent;
    }
    return this.withImaginary(cursor, isFloat ? TokenId.DECIMAL_FLOAT_LIT : TokenId.DECIMAL_LIT);
  }

  private scanQuoted(start: Mark, quote: string, kind: LexicalTokenId, diagnosticCode: LexDiagnosticCode): void {
    let cursor = this.index + quote.length;
    while (cursor < this.source.length) {
      const character = this.characterAt(cursor);
      if (character === "\\") {
        cursor += character.length;
        if (cursor < this.source.length) {
          cursor += this.characterAt(cursor).length;
        }
      } else if (character === quote) {
        this.emit(kind, start, cursor + quote.length);
        return;
      } else {
        cursor += character.length;
      }
    }

    this.emit(kind, start, this.source.length);
    this.addDiagnostic(
      diagnosticCode,
      `Unterminated ${quote === "'" ? "rune" : "interpreted string"} literal.`,
      start,
      this.position(),
    );
  }

  private scanRawString(start: Mark): void {
    let cursor = this.index + 1;
    while (cursor < this.source.length && this.characterAt(cursor) !== "`") {
      cursor += this.characterAt(cursor).length;
    }

    if (cursor < this.source.length) {
      this.emit(TokenId.RAW_STRING_LIT, start, cursor + 1);
      return;
    }

    this.emit(TokenId.RAW_STRING_LIT, start, this.source.length);
    this.addDiagnostic("unterminated-raw-string", "Unterminated raw string literal.", start, this.position());
  }

  private scanWhitespace(start: number): number {
    let cursor = start;
    while (isWhitespaceCharacter(this.characterAt(cursor))) {
      cursor += this.characterAt(cursor).length;
    }
    return cursor;
  }

  private startsWith(text: string): boolean {
    return this.source.startsWith(text, this.index);
  }

  private withImaginary(end: number, kind: LexicalTokenId): NumericToken {
    return this.characterAt(end) === "i"
      ? { kind: TokenId.IMAGINARY_LIT, end: end + 1 }
      : { kind, end };
  }

  private advanceTo(end: number): void {
    while (this.index < end) {
      const character = this.characterAt(this.index);
      this.index += character.length;
      if (character === "\r") {
        this.line += 1;
        this.column = 0;
        this.previousWasCarriageReturn = true;
      } else if (character === "\n") {
        if (!this.previousWasCarriageReturn) {
          this.line += 1;
        }
        this.column = 0;
        this.previousWasCarriageReturn = false;
      } else {
        this.column += character.length;
        this.previousWasCarriageReturn = false;
      }
    }
  }
}

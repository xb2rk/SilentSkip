/**
 * Parser cursor over significant (non-trivia) tokens.
 *
 * Maintains the current position in significant tokens while recording
 * absolute indices into the complete lossless token stream.
 */

import { TokenId } from "../grammar/token-vocabulary.generated.js";
import type { Token } from "../lex/token.js";
import { isTrivia } from "../lex/trivia.js";

/**
 * A token coupled with its absolute index in the original token array.
 */
export interface CursorToken {
  readonly index: number;
  readonly token: Token;
}

/**
 * Cursor navigating significant tokens with backtracking and lookahead.
 */
export class ParserCursor {
  private position = 0;
  private readonly significantIndices: readonly number[];

  public constructor(private readonly tokens: readonly Token[]) {
    this.significantIndices = tokens.flatMap((token, index) =>
      token.kind === TokenId.EOF || !isTrivia(token) ? [index] : [],
    );
  }

  /**
   * Returns true if the current token matches the specified TokenId.
   */
  public at(kind: number): boolean {
    return this.current().token.kind === kind;
  }

  /**
   * Creates a restoration checkpoint of the current cursor position.
   */
  public checkpoint(): number {
    return this.position;
  }

  /**
   * Returns the current significant token without advancing.
   */
  public current(): CursorToken {
    const index = this.significantIndices[this.position] ?? this.tokens.length - 1;
    const token = this.tokens[index];
    if (!token) {
      throw new Error("ParserCursor requires an EOF token.");
    }
    return { index, token };
  }

  /**
   * Consumes and returns the current token, advancing the cursor to the next significant token.
   */
  public advance(): CursorToken {
    const current = this.current();
    if (current.token.kind !== TokenId.EOF) {
      this.position += 1;
    }
    return current;
  }

  /**
   * Looks ahead `distance` significant tokens without advancing.
   */
  public peek(distance = 0): CursorToken {
    const index = this.significantIndices[this.position + distance] ?? this.tokens.length - 1;
    const token = this.tokens[index];
    if (!token) {
      throw new Error("ParserCursor requires an EOF token.");
    }
    return { index, token };
  }

  /**
   * Restores the cursor position to a previously saved checkpoint.
   */
  public restore(checkpoint: number): void {
    this.position = checkpoint;
  }
}

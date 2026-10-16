/**
 * High-performance stateful string builder with column tracking, indentation management,
 * and line-ending awareness.
 *
 * @see CODING_CONVENTION.md §Formatting
 */

import type { EndOfLine, ResolvedFormatOptions } from "./options.js";

/**
 * Writer state machine for generating consistently indented and aligned FC code.
 */
export class TokenWriter {
  private result = "";
  public column = 0;
  public indent = 0;
  public activeLineIndent = 0;
  public nextLineIndent: number | undefined;
  public lineStart = true;
  private readonly eol: string;

  public constructor(
    private readonly options: ResolvedFormatOptions,
    detectedEol: string = "\n",
  ) {
    if (options.endOfLine === "crlf") {
      this.eol = "\r\n";
    } else if (options.endOfLine === "lf") {
      this.eol = "\n";
    } else {
      this.eol = detectedEol === "\r\n" ? "\r\n" : "\n";
    }
  }

  /**
   * Current uncommitted output length in characters.
   */
  public get length(): number {
    return this.result.length;
  }

  /**
   * Appends text, automatically prefixing indentation if starting a new line.
   */
  public write(value: string): void {
    if (this.lineStart) {
      const lineIndent = this.nextLineIndent ?? this.indent;
      const prefix = (this.options.useTabs ? "\t" : " ".repeat(this.options.tabWidth)).repeat(lineIndent);
      this.result += prefix;
      this.column = lineIndent * this.options.tabWidth;
      this.activeLineIndent = lineIndent;
      this.lineStart = false;
      this.nextLineIndent = undefined;
    }
    this.result += value;
    this.column += value.length;
  }

  /**
   * Appends a single space if not at the start of a line and preceding character is not whitespace.
   */
  public space(): void {
    if (
      !this.lineStart &&
      !this.result.endsWith(" ") &&
      !this.result.endsWith("\n") &&
      !this.result.endsWith("\r")
    ) {
      this.result += " ";
      this.column += 1;
    }
  }

  /**
   * Trims trailing horizontal whitespace (spaces and tabs) from the current line.
   */
  public trim(): void {
    this.result = this.result.replace(/[ \t]+$/u, "");
  }

  /**
   * Breaks the current line and resets column tracking.
   */
  public newline(): void {
    this.trim();
    if (!this.result.endsWith("\n")) {
      this.result += this.eol;
    }
    this.column = 0;
    this.lineStart = true;
    this.nextLineIndent = undefined;
  }

  /**
   * Breaks the line and prepares the next line with a specific custom indentation level.
   */
  public newlineAtIndent(indent: number): void {
    this.newline();
    this.nextLineIndent = indent;
  }

  /**
   * Emits preserved blank lines from original source trivia.
   */
  public sourceLineBreaks(count: number, collapseBlankLines: boolean): void {
    this.newline();
    const desired = collapseBlankLines ? 2 : count;
    const trailingNewlines = (this.result.match(/(?:\r?\n)+$/u)?.[0].match(/\n/g) ?? []).length;
    const needed = Math.max(0, desired - trailingNewlines);
    if (needed > 0) {
      this.result += this.eol.repeat(needed);
    }
  }

  /**
   * Checks whether the current buffer ends with a comma (ignoring trailing whitespace).
   */
  public hasTrailingComma(): boolean {
    return /,\s*$/u.test(this.result);
  }

  /**
   * Completes the formatting run, enforcing final newline options and stripping trailing whitespace.
   */
  public finish(): string {
    this.trim();
    if (this.options.insertFinalNewline && this.result && !this.result.endsWith("\n")) {
      this.result += this.eol;
    }
    if (!this.options.insertFinalNewline) {
      this.result = this.result.replace(/(?:\r?\n)+$/u, "");
    }
    // Final pass: clean any horizontal whitespace preceding a line break
    return this.result.replace(/[ \t]+\r?\n/gu, this.eol);
  }
}

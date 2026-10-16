/**
 * Column alignment for map literal colons (`:`) and struct literal assignments (`=`).
 *
 * @see README.md §Alignment
 */

import type { Token } from "../lex/token.js";
import type { NameNode, SyntaxNode } from "../syntax/core.js";
import type { ExpressionNode, MapCompositeExpressionNode, StructCompositeExpressionNode } from "../syntax/expressions.js";
import type { ResolvedFormatOptions } from "./options.js";

export interface CompositeSeparatorAlignment {
  readonly keyWidth: number;
  readonly openOffset: number;
}

/**
 * Derives column alignment targets for struct fields and map entries.
 */
export class AlignmentManager {
  private readonly alignments = new Map<number, CompositeSeparatorAlignment>();

  public constructor(
    private readonly options: ResolvedFormatOptions,
    private readonly tokens: readonly Token[],
  ) {}

  /**
   * Retrieves alignment record for a separator token, if aligned.
   */
  public getAlignment(separatorOffset: number): CompositeSeparatorAlignment | undefined {
    if (!this.options.alignCompositeSeparators) return undefined;
    return this.alignments.get(separatorOffset);
  }

  /**
   * Collects column alignment targets for a single map or struct composite node.
   */
  public collectComposite(
    node: MapCompositeExpressionNode | StructCompositeExpressionNode,
    flatNodeWidthFn: (node: SyntaxNode | undefined) => number,
  ): void {
    if (!this.options.alignCompositeSeparators) return;

    const open = this.tokenAt(node.leftCurlyTokenIndex);
    if (!open) return;

    const candidates: readonly {
      readonly key: ExpressionNode | NameNode | undefined;
      readonly separatorTokenIndex: number | undefined;
    }[] =
      node.kind === "map-composite-expression"
        ? node.entries.map((entry) => ({ key: entry.key, separatorTokenIndex: entry.colonTokenIndex }))
        : node.fields.map((field) => ({ key: field.name, separatorTokenIndex: field.assignTokenIndex }));

    const resolved = candidates.map((candidate) => ({
      keyWidth: flatNodeWidthFn(candidate.key),
      separator: this.tokenAt(candidate.separatorTokenIndex),
    }));

    if (!resolved.length || resolved.some((c) => !c.separator || !Number.isFinite(c.keyWidth))) {
      return;
    }

    const maxKeyWidth = Math.max(...resolved.map((c) => c.keyWidth));
    for (const candidate of resolved) {
      const separator = candidate.separator;
      if (separator) {
        this.alignments.set(separator.range.start.offset, {
          keyWidth: maxKeyWidth,
          openOffset: open.range.start.offset,
        });
      }
    }
  }

  private tokenAt(index: unknown): Token | undefined {
    return typeof index === "number" ? this.tokens[index] : undefined;
  }
}

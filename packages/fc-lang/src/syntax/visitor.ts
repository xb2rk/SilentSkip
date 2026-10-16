/**
 * AST visitor and traversal utilities.
 */

import type { AnySyntaxNode } from "./guards.js";
import { isSyntaxNodeValue } from "./guards.js";

/**
 * Throws an error on a value proven unreachable by TypeScript's type system.
 * Use in the `default:` clause of exhaustive switches.
 */
export function assertNever(value: never, message = "Unexpected syntax node kind."): never {
  throw new Error(`${message} Received: ${JSON.stringify(value)}`);
}

/**
 * Returns the immediate child syntax nodes of any given syntax node (in depth-first declaration order).
 */
export function astChildren(node: AnySyntaxNode): readonly AnySyntaxNode[] {
  const result: AnySyntaxNode[] = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isSyntaxNodeValue(item)) {
          result.push(item);
        }
      }
    } else if (isSyntaxNodeValue(value)) {
      result.push(value);
    }
  }
  return result;
}

/**
 * Depth-first AST traversal.
 *
 * Calls `visitor(node)` for each node. Returning `"skip"` suppresses traversal into
 * that node's children (the `exit` callback is still called).
 *
 * @param root - Single root node or list of nodes to traverse.
 * @param visitor - Callback invoked when entering a node.
 * @param exit - Optional callback invoked when exiting a node.
 */
export function walkAst(
  root: AnySyntaxNode | readonly AnySyntaxNode[],
  visitor: (node: AnySyntaxNode) => "skip" | void,
  exit?: (node: AnySyntaxNode) => void,
): void {
  if (Array.isArray(root)) {
    for (const item of root) {
      walkAst(item, visitor, exit);
    }
    return;
  }

  const node = root as AnySyntaxNode;
  if (visitor(node) === "skip") {
    exit?.(node);
    return;
  }

  for (const child of astChildren(node)) {
    walkAst(child, visitor, exit);
  }

  exit?.(node);
}

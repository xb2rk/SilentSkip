/**
 * fc-format-v4: Next-Generation FC Language Toolchain & Formatter.
 *
 * @packageDocumentation
 */

export * from "./grammar/index.js";
export * from "./lex/index.js";
export * from "./syntax/index.js";
export * from "./parser/index.js";
export * from "./imports/index.js";
export * from "./format/index.js";

import { formatSource, type FormatOptions, type FormatResult } from "./format/index.js";

/**
 * Convenient shorthand alias for `formatSource`.
 */
export const format = formatSource;
export default formatSource;

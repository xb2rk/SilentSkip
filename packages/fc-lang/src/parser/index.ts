/**
 * Parser subsystem barrel exports.
 */

export * from "./cursor.js";
export * from "./diagnostic.js";
export * from "./recovery.js";
export * from "./statement-boundary.js";
export * from "./context.js";
export {
  parseDomainType as parseDomainTypeNode,
  parseTypeCore,
  parseGenericType,
  parseFunctionType,
} from "./type-parser.js";
export * from "./composite-parser.js";
export {
  parseExpression as parseExpressionNode,
  parsePrefixExpression,
  parsePostfix,
  parseCall,
  parseOutVarArgument,
  parseIndex,
  parseMember,
  parsePrefixedCall,
  parseParenthesizedExpression,
  parseTypeofExpression,
  parseQualifiedName,
  peekBinaryOperator,
  tryParseGenericAccess,
  hasVirtualBoundaryAfter,
  hasVirtualBoundaryAfterToken,
} from "./expression-parser.js";
export * from "./statement-parser.js";
export * from "./declaration-parser.js";
export * from "./file-parser.js";

/**
 * Lexical spelling rules and category predicates layered on top of generated FC token IDs.
 *
 * This module defines exact keyword mappings, multi-character operators, and single-character
 * delimiters as specified in the Free Fire Craftland Code (FC) grammar.
 *
 * @see GRAMMAR.md §2 (Lexical Rules)
 */

import { TokenId, type TokenId as TokenIdValue } from "./token-vocabulary.generated.js";

export type LexicalTokenId = TokenIdValue;

type SpellingEntry = readonly [text: string, kind: LexicalTokenId];

/**
 * All reserved FC keywords and built-in type literals mapped to their canonical TokenId.
 * @see GRAMMAR.md §2.1 (Keywords and Reserved Names)
 */
const KEYWORD_ENTRIES: readonly SpellingEntry[] = [
  ["define", TokenId.DEFINE],
  ["alias", TokenId.ALIAS],
  ["enum", TokenId.ENUM],
  ["tuple", TokenId.TUPLE],
  ["abstract", TokenId.ABSTRACT],
  ["component", TokenId.COMPONENT],
  ["struct", TokenId.STRUCT],
  ["export", TokenId.EXPORT],
  ["partial", TokenId.PARTIAL],
  ["readonly", TokenId.READONLY],
  ["accept", TokenId.ACCEPT],
  ["bridging", TokenId.BRIDGING],
  ["combine", TokenId.COMBINE],
  ["declare", TokenId.DECLARE],
  ["element", TokenId.ELEMENT],
  ["import", TokenId.IMPORT],
  ["from", TokenId.FROM],
  ["static", TokenId.STATIC],
  ["graph", TokenId.GRAPH],
  ["bind", TokenId.BIND],
  ["event", TokenId.EVENT],
  ["func", TokenId.FUNC],
  ["start", TokenId.START],
  ["wait", TokenId.WAIT],
  ["async", TokenId.ASYNC],
  ["if", TokenId.IF],
  ["else", TokenId.ELSE],
  ["for", TokenId.FOR],
  ["in", TokenId.IN],
  ["while", TokenId.WHILE],
  ["break", TokenId.BREAK],
  ["continue", TokenId.CONTINUE],
  ["return", TokenId.RETURN],
  ["switch", TokenId.SWITCH],
  ["case", TokenId.CASE],
  ["var", TokenId.VAR],
  ["as", TokenId.AS],
  ["thisEntity", TokenId.THISENTITY],
  ["globalEntity", TokenId.GLOBALENTITY],
  ["out", TokenId.OUT],
  ["typeof", TokenId.TYPEOF],
  ["object", TokenId.OBJECT],
  ["Type", TokenId.TYPE],
  ["bool", TokenId.BOOL],
  ["int", TokenId.INT],
  ["int64", TokenId.INT64],
  ["float", TokenId.FLOAT],
  ["string", TokenId.STRING],
  ["Color", TokenId.COLOR],
  ["Vector2", TokenId.VECTOR2],
  ["Vector3", TokenId.VECTOR3],
  ["Quaternion", TokenId.QUATERNION],
  ["List", TokenId.LIST],
  ["Map", TokenId.MAP],
  ["LocString", TokenId.LOC_STRING],
  ["entity", TokenId.ENTITY],
  ["true", TokenId.TRUE],
  ["false", TokenId.FALSE],
  ["nil", TokenId.NIL_LIT],
] as const;

/**
 * Fast lookup map from keyword text to TokenId.
 */
export const KEYWORD_TOKEN_IDS: ReadonlyMap<string, LexicalTokenId> = new Map(KEYWORD_ENTRIES);

/**
 * Multi-character operators ordered longest-first for greedy prefix matching.
 * Note: `<<` and `>>` are intentionally omitted here because ANTLR lexes them as
 * two consecutive `<` or `>` tokens; parser phases reassociate them in expression context.
 * @see GRAMMAR.md §2.4 (Operators and Punctuation)
 */
export const MULTI_CHARACTER_TOKEN_IDS: readonly SpellingEntry[] = [
  ["<<=", TokenId.LSHIFT_ASSIGN],
  [">>=", TokenId.RSHIFT_ASSIGN],
  ["++", TokenId.PLUS_PLUS],
  ["--", TokenId.MINUS_MINUS],
  [":=", TokenId.DECLARE_ASSIGN],
  ["||", TokenId.LOGICAL_OR],
  ["&&", TokenId.LOGICAL_AND],
  ["==", TokenId.EQUALS],
  ["!=", TokenId.NOT_EQUALS],
  ["<=", TokenId.LESS_OR_EQUALS],
  [">=", TokenId.GREATER_OR_EQUALS],
  ["+=", TokenId.PLUS_ASSIGN],
  ["-=", TokenId.MINUS_ASSIGN],
  ["*=", TokenId.STAR_ASSIGN],
  ["/=", TokenId.DIV_ASSIGN],
  ["%=", TokenId.MOD_ASSIGN],
  ["&=", TokenId.AND_ASSIGN],
  ["^=", TokenId.XOR_ASSIGN],
  ["|=", TokenId.OR_ASSIGN],
] as const;

/**
 * Single-character operators and punctuation table.
 */
export const SINGLE_CHARACTER_TOKEN_IDS: ReadonlyMap<string, LexicalTokenId> = new Map([
  ["(", TokenId.L_PAREN],
  [")", TokenId.R_PAREN],
  ["{", TokenId.L_CURLY],
  ["}", TokenId.R_CURLY],
  ["[", TokenId.L_BRACKET],
  ["]", TokenId.R_BRACKET],
  [",", TokenId.COMMA],
  [";", TokenId.SEMI],
  [":", TokenId.COLON],
  [".", TokenId.DOT],
  ["#", TokenId.HASHTAG],
  ["=", TokenId.ASSIGN],
  ["<", TokenId.LESS],
  [">", TokenId.GREATER],
  ["|", TokenId.OR],
  ["/", TokenId.DIV],
  ["%", TokenId.MOD],
  ["&", TokenId.AND],
  ["^", TokenId.XOR],
  ["!", TokenId.EXCLAMATION],
  ["~", TokenId.BIT_NOT],
  ["+", TokenId.PLUS],
  ["-", TokenId.MINUS],
  ["*", TokenId.STAR],
]);

const WHITESPACE_CHARS = new Set([" ", "\t", "\r", "\n", "\u00a0", "\f"]);
const IDENTIFIER_START_PATTERN = /^(?:\p{L}|_)$/u;
const IDENTIFIER_CONTINUE_PATTERN = /^(?:\p{L}|\p{N}|_)$/u;

/**
 * Checks whether the given character is considered lexical whitespace in FC.
 */
export function isWhitespaceCharacter(character: string): boolean {
  return WHITESPACE_CHARS.has(character);
}

/**
 * Checks whether the given character can legally start an identifier.
 */
export function isIdentifierStart(character: string): boolean {
  return IDENTIFIER_START_PATTERN.test(character);
}

/**
 * Checks whether the given character can legally continue an identifier.
 */
export function isIdentifierContinue(character: string): boolean {
  return IDENTIFIER_CONTINUE_PATTERN.test(character);
}

/**
 * Checks whether the given character is a decimal digit (0-9).
 */
export function isDecimalDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

/**
 * Checks whether the given character is a valid hexadecimal digit (0-9, a-f, A-F).
 */
export function isHexDigit(character: string): boolean {
  return /^[0-9a-f]$/i.test(character);
}

/**
 * Resolves keyword spelling to its corresponding TokenId, or undefined if not a keyword.
 */
export function tokenIdForKeyword(text: string): LexicalTokenId | undefined {
  return KEYWORD_TOKEN_IDS.get(text);
}

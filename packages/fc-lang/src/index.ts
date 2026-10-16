/**
 * Placeholder entry point for the vendored fc-lang toolchain.
 *
 * The real implementation (lexer/parser/AST/visitor) is vendor-copied from
 * `fc-format-v4` in Phase 1 / E2 — see the package README for the vendoring checklist.
 */

/** Marker so consumers can detect (in tests) that the toolchain is not yet vendored. */
export const FC_LANG_VENDORED = false;

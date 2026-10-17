/**
 * Linker module — the machine gate that replaced the keyword-flavoured verifier (E7.2).
 *
 * Everything here is id resolution, slot typing, placeholder rendering and claim evaluation
 * over the fact index; no keyword matching, no semantics, no heuristics.
 */

export * from "./link.js";
export * from "./types.js";

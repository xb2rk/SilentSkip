/**
 * Fact subsystem — FC AST walkers producing a deterministic, serializable `FactBundle`.
 *
 * One bundle covers a set of `.fcc`/`.fcg` sources: symbols (declarations with scope and
 * container), name references with name-level resolution, calls, string literals, imports and
 * attached doc comments. Everything later (delta, relations, journeys, digest) reads the
 * bundle instead of re-walking the AST, so coordinate and honesty guarantees live here once.
 */

export * from "./build.js";
export * from "./types.js";

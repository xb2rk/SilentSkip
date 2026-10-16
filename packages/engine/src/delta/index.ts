/**
 * Delta barrel — A/B diff of script facts and CSV tables.
 *
 * `buildDeltaBundle({ before, after })` is pure and deterministic; it never
 * repairs or guesses input, it reports differences keyed by stable identity
 * (see {@link DELTA_SCHEMA_VERSION} doc in `types.ts`).
 */

export * from "./build.js";
export * from "./types.js";

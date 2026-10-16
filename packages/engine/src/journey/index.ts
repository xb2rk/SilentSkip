/**
 * Journey barrel — layered value propagation chains.
 *
 * `buildJourney({ bundle, relations, origin })` is pure and deterministic; it
 * never guesses past a relation, and an empty journey carries an explicit
 * dead-value note instead of silence.
 */

export * from "./build.js";
export * from "./types.js";

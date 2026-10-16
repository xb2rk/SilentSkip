/**
 * Relations subsystem — v1 syntax-graph edges derived from a `FactBundle`.
 *
 * Pure and deterministic: the bundle, plus an explicit CSV path list, are the only inputs.
 * Rules never guess: a site that does not resolve (or matches more than one target) simply
 * produces no relation, and the honesty of that decision is visible in the bundle's own
 * resolution status.
 */

export * from "./build.js";
export * from "./types.js";

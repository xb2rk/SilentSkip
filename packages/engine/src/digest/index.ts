/**
 * Digest v1 — the deterministic fact sheet (spec §4.6): change facts (layer 1), linked
 * journeys (layer 2) and supporting context (layer 4), every item anchored in verifiable
 * source spans with a content-stable anchor id.
 *
 * The builder is pure: same inputs + same version ⇒ byte-identical output. No clocks, no
 * environment reads; blob hashes are computed from the given content, not from git.
 */

export * from "./build.js";
export * from "./types.js";

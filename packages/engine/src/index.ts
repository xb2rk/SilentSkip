/**
 * Craftland QA deterministic analysis engine.
 *
 * Phase 1 / E2 lands the first real content: the FC syntax index (via @craftland-qa/fc-lang),
 * CSV parsing, syntax-graph relations and the Value Journey walker. Invariants that hold from
 * day one:
 * - Deterministic: same inputs + version => identical outputs (no clocks, no randomness).
 * - Universal: nothing about a specific project is hardcoded here; project-specific knowledge
 *   comes in as data (Project Profile) and everything else is derived from the FC grammar,
 *   CSV files and git.
 * - Confidence-labeled: every derived relation carries exact | inferred | unknown and only
 *   `exact` may create hard findings.
 */

/** Package version marker — replaced by real engine exports as E2 lands. */
export const ENGINE_VERSION = "0.1.0";

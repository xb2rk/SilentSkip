/**
 * Citation verifier (E4.3) — deterministic post-checks over every pass output.
 *
 * Rules live in `verify.ts`; issue kinds and counters in `types.ts`. The verifier never guesses:
 * unverifiable anchors are stripped, unverifiable numbers/quotes downgrade confidence, and all
 * of it is reported as `VerifyIssue`s.
 */
export * from "./types.js";
export * from "./verify.js";

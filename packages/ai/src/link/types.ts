import type { PassConfidence, TypedClaim } from "@craftland-qa/contracts";

/**
 * Linker types (E7.2, decision #28).
 *
 * The linker replaces the old keyword-flavoured verifier: it resolves ids, types slots, renders
 * placeholders and evaluates claims — pure set/type arithmetic over the fact index. Every strip
 * or downgrade becomes a `LinkIssue` with counters, so nothing disappears silently.
 */

/** Which pass produced the linked output. */
export type LinkPass = "map" | "read" | "dig" | "synthesize";

/** Everything the linker can report about a claim it stripped or downgraded. */
export type LinkIssueKind =
  | "unknown-anchor"
  | "new-anchor"
  | "finding-unanchored"
  | "unknown-fact"
  | "free-number"
  | "claim-invalid"
  | "claim-false"
  | "quote-unverified"
  | "theme-invalid"
  | "map-invalid"
  | "read-invalid"
  | "dig-invalid"
  | "synthesize-invalid"
  | "verdict-downgraded";

/** One linker issue — kind, pass, target and a human-readable detail. */
export interface LinkIssue {
  readonly kind: LinkIssueKind;
  readonly pass: LinkPass;
  readonly target: string;
  readonly detail: string;
}

/** Linker counters of one pass — every check and every strip is counted. */
export interface LinkStats {
  readonly findingsChecked: number;
  readonly findingsStripped: number;
  readonly anchorsChecked: number;
  readonly anchorsStripped: number;
  readonly numbersChecked: number;
  readonly numbersUnverified: number;
  readonly quotesChecked: number;
  readonly quotesUnverified: number;
  readonly confidenceDowngraded: number;
}

/** The minimum shape the linker needs from any finding (read, dig or synthesize). */
export interface LinkableFinding {
  readonly title: string;
  readonly statement: string;
  readonly anchors: string[];
  readonly confidence: PassConfidence;
  readonly claims: readonly TypedClaim[];
}

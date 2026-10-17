import type { PassConfidence } from "@craftland-qa/contracts";

/**
 * Citation-verifier types (plan §5.4).
 *
 * The verifier is the seam that keeps the LLM from ever becoming a fact source: every finding
 * that flows onward must cite anchor ids that exist in the evidence pack, numbers must be
 * traceable to engine metrics / cited snippets / the goal, and `synthesize` may not introduce
 * anchors that earlier passes never verified. Violations are stripped or downgraded — and always
 * counted, never hidden.
 */

/** Why a claim was stripped or downgraded. */
export type VerifyIssueKind =
  | "unknown-anchor" // cited anchor id is not in the evidence pack
  | "new-anchor" // synthesize cited an anchor never verified in an earlier pass
  | "finding-unanchored" // every anchor was stripped, so the finding was removed
  | "number-unverified" // number not traceable to engine metrics, the goal, or cited snippets
  | "quote-unverified" // quoted fragment not found in the cited snippets
  | "verdict-downgraded"; // all findings stripped → verdict forced to insufficient_evidence

/** One verifier finding — the audit trail behind every strip and downgrade. */
export interface VerifyIssue {
  readonly kind: VerifyIssueKind;
  readonly pass: "digest_read" | "dig" | "synthesize";
  /** Finding title (or statement when untitled), or `verdict` for report-level issues. */
  readonly target: string;
  readonly detail: string;
}

/** Honest counts of what the verifier inspected and what it had to act on. */
export interface VerifyStats {
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

/** Minimal shape both finding schemas satisfy — the verifier works generically over them. */
export interface VerifyCandidate {
  readonly title?: string;
  readonly statement: string;
  readonly anchors: readonly string[];
  readonly confidence: PassConfidence;
}

/** Outcome of verifying a batch of findings: survivors, audit trail, counts. */
export interface VerifiedFindings<T extends VerifyCandidate> {
  readonly findings: readonly T[];
  readonly issues: readonly VerifyIssue[];
  readonly stats: VerifyStats;
}

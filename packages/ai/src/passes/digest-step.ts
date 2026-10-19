import type { ReadFinding, TypedClaim } from "@silentskip/contracts";
import { compareStrings } from "../text/compare.js";

/**
 * The deterministic merge step between reading and writing (E7.2).
 *
 * Findings arrive already linked (anchors verified, placeholders rendered, claims evaluated —
 * only true claims survive), so the merge is pure set arithmetic: dedupe by statement + anchors
 * + claim key, order by severity. No model involvement.
 */

/** The deduplicated, linked reading output that flows into `synthesize` — facts, no prose. */
export interface StructuredFindings {
  readonly findings: ReadFinding[];
  readonly unknowns: string[];
  readonly negativeResults: string[];
  readonly answers: string[];
}

const SEVERITY_RANK = { critical: 0, major: 1, minor: 2, info: 3 } as const;

/** Merges every read/dig output into the structured set `synthesize` works from. */
export function mergeStructured(input: {
  readonly findings: readonly ReadFinding[];
  readonly unknowns: readonly string[];
  readonly negativeResults: readonly string[];
  readonly answers: readonly string[];
}): StructuredFindings {
  const findings: ReadFinding[] = [];
  const seen = new Set<string>();
  for (const finding of input.findings) {
    const key = `${normalizeStatement(finding.statement)}|${[...finding.anchors].sort().join(",")}|${claimKey(finding.claims)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(finding);
  }
  findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      compareStrings(normalizeStatement(a.statement), normalizeStatement(b.statement)),
  );
  return {
    findings,
    unknowns: dedupe(input.unknowns),
    negativeResults: dedupe(input.negativeResults),
    answers: dedupe(input.answers),
  };
}

function claimKey(claims: readonly TypedClaim[]): string {
  return claims
    .map((claim) => `${claim.subject}${claim.relation}${claim.object}`)
    .sort()
    .join(";");
}

function normalizeStatement(statement: string): string {
  return statement.trim().toLowerCase().replace(/\s+/gu, " ");
}

function dedupe(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const key = normalizeStatement(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

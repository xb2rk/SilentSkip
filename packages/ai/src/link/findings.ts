import type { TypedClaim } from "@silentskip/contracts";
import {
  evaluateClaim,
  type FactIndex,
  findFreeNumbers,
  renderStatement,
} from "../facts/fact-index.js";
import { collectQuoteViolations, countQuotes } from "./quotes.js";
import type { LinkableFinding, LinkIssue, LinkPass, LinkStats } from "./types.js";

/** Options of one `linkFindings` run. */
export interface LinkFindingsOptions {
  readonly pass: LinkPass;
  /** When passed, anchors outside this set are `new-anchor` violations (synthesize). */
  readonly seenAnchors?: ReadonlySet<string>;
  /** Extra literals allowed to contain digits (e.g. theme ids). */
  readonly extraLiterals?: readonly string[];
}

/** Result of linking a finding list. */
export interface LinkFindingsResult<T extends LinkableFinding> {
  readonly findings: T[];
  readonly issues: LinkIssue[];
  readonly stats: LinkStats;
}

/**
 * Links one list of findings: returns the survivors (statements rendered, claims filtered to the
 * true ones, anchors verified) plus the full issue list and counters.
 */
export function linkFindings<T extends LinkableFinding>(
  findings: readonly T[],
  index: FactIndex,
  options: LinkFindingsOptions,
): LinkFindingsResult<T> {
  const issues: LinkIssue[] = [];
  const kept: T[] = [];
  const extraLiterals = options.extraLiterals ?? [];
  let findingsChecked = 0;
  let findingsStripped = 0;
  let anchorsChecked = 0;
  let anchorsStripped = 0;
  let numbersChecked = 0;
  let numbersUnverified = 0;
  let quotesChecked = 0;
  let quotesUnverified = 0;
  let confidenceDowngraded = 0;

  for (const finding of findings) {
    findingsChecked += 1;
    const target = finding.title;

    anchorsChecked += finding.anchors.length;
    const anchors = finding.anchors.filter((anchorId) => {
      if (!index.anchors.has(anchorId)) {
        anchorsStripped += 1;
        issues.push({
          kind: "unknown-anchor",
          pass: options.pass,
          target,
          detail: `anchor not in the registry: ${anchorId}`,
        });
        return false;
      }
      if (options.seenAnchors !== undefined && !options.seenAnchors.has(anchorId)) {
        anchorsStripped += 1;
        issues.push({
          kind: "new-anchor",
          pass: options.pass,
          target,
          detail: `anchor not cited by any verified finding: ${anchorId}`,
        });
        return false;
      }
      return true;
    });
    if (anchors.length === 0) {
      findingsStripped += 1;
      issues.push({
        kind: "finding-unanchored",
        pass: options.pass,
        target,
        detail: "no verifiable anchor survived linking",
      });
      continue;
    }

    const rendered = renderStatement(finding.statement, index);
    numbersChecked += rendered.factIds.length;
    if (rendered.unknownIds.length > 0) {
      numbersUnverified += rendered.unknownIds.length;
      findingsStripped += 1;
      issues.push({
        kind: "unknown-fact",
        pass: options.pass,
        target,
        detail: `statement cites unknown fact id(s): ${rendered.unknownIds.join(", ")}`,
      });
      continue;
    }
    const freeNumbers = [
      ...findFreeNumbers(finding.title, index, extraLiterals),
      ...findFreeNumbers(finding.statement, index, extraLiterals),
    ];
    if (freeNumbers.length > 0) {
      findingsStripped += 1;
      issues.push({
        kind: "free-number",
        pass: options.pass,
        target,
        detail: `number(s) without a fact source: ${freeNumbers.slice(0, 5).join(", ")}`,
      });
      continue;
    }

    const claims: TypedClaim[] = [];
    let claimFailure = false;
    for (const claim of finding.claims) {
      numbersChecked += 1;
      const verdict = evaluateClaim(claim, index);
      if (verdict === "true") {
        claims.push(claim);
        continue;
      }
      numbersUnverified += 1;
      claimFailure = true;
      issues.push({
        kind: verdict === "false" ? "claim-false" : "claim-invalid",
        pass: options.pass,
        target,
        detail: `claim ${claim.subject} ${claim.relation} ${claim.object} evaluated ${verdict}`,
      });
    }
    if (claimFailure) {
      findingsStripped += 1;
      continue;
    }

    const quoteViolations = collectQuoteViolations(rendered.text, anchors, index);
    quotesChecked += countQuotes(rendered.text);
    if (quoteViolations.length > 0) {
      quotesUnverified += quoteViolations.length;
      confidenceDowngraded += 1;
      issues.push({
        kind: "quote-unverified",
        pass: options.pass,
        target,
        detail: `quoted text not in cited snippets: ${quoteViolations.slice(0, 3).join(" | ")}`,
      });
      kept.push({
        ...finding,
        statement: rendered.text,
        anchors,
        claims,
        confidence: "unknown",
      } as T);
      continue;
    }
    kept.push({ ...finding, statement: rendered.text, anchors, claims } as T);
  }

  return {
    findings: kept,
    issues,
    stats: {
      findingsChecked,
      findingsStripped,
      anchorsChecked,
      anchorsStripped,
      numbersChecked,
      numbersUnverified,
      quotesChecked,
      quotesUnverified,
      confidenceDowngraded,
    },
  };
}

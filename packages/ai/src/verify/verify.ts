import type { SynthesizeOutput } from "@craftland-qa/contracts";
import type { EvidenceAnchor, ReviewContext } from "../context/types.js";
import type { VerifiedFindings, VerifyCandidate, VerifyIssue, VerifyStats } from "./types.js";

/**
 * The citation verifier (E4.3) — deterministic, model-independent, and mandatory.
 *
 * Checks, in order, per finding:
 *  1. every cited anchor id exists in the anchor registry — the full digest when `allAnchors` is
 *     passed, the evidence pack otherwise (else the anchor is stripped);
 *  2. for `synthesize`, every anchor was already verified in an earlier pass (no new anchors);
 *  3. a finding with zero surviving anchors is removed entirely;
 *  4. every number in title/statement is traceable to engine metrics, the goal, or the cited
 *     snippets (else the finding's confidence is downgraded to `unknown`);
 *  5. every quoted fragment appears (whitespace-normalized) in the cited snippets.
 *
 * Nothing here is silent: every strip and downgrade emits a `VerifyIssue` and moves a counter.
 * Limitations (documented, not hidden): numbers are matched as tokens, so a value that the model
 * re-expressed (e.g. "75%" for a `0.75` in code) is downgraded rather than recomputed — v2 can
 * add arithmetic recompute on top of the same issue stream.
 */

/** Options controlling one verification pass. */
export interface VerifyOptions {
  readonly pass: "digest_read" | "dig" | "synthesize";
  /**
   * Anchor ids `synthesize` may cite — the union of anchors verified in earlier passes.
   * `undefined` disables the new-anchor check (used for `digest_read` and `dig`).
   */
  readonly seenAnchors?: ReadonlySet<string>;
  /**
   * The authoritative anchor registry — every anchor of the digest, not just the budgeted
   * evidence pack. Citations are checked against it: the pack is attention economy, the digest
   * is the authority. Falls back to `context.evidence` when omitted.
   */
  readonly allAnchors?: readonly EvidenceAnchor[];
}

const NUMBER_PATTERN = /\d+(?:\.\d+)?/gu;
const QUOTE_PATTERN = /"([^"]{8,})"/gu;

/** Verify a batch of findings against the context's evidence pack. Pure and deterministic. */
export function verifyFindings<T extends VerifyCandidate>(
  context: ReviewContext,
  findings: readonly T[],
  options: VerifyOptions,
): VerifiedFindings<T> {
  const lookup = options.allAnchors ?? context.evidence;
  const evidenceById = new Map(lookup.map((anchor) => [anchor.id, anchor]));
  const engineNumberText = JSON.stringify({
    stats: context.taskPack.stats,
    counts: context.manifest.counts,
  });
  const issues: VerifyIssue[] = [];
  const kept: T[] = [];
  let findingsStripped = 0;
  let anchorsChecked = 0;
  let anchorsStripped = 0;
  let numbersChecked = 0;
  let numbersUnverified = 0;
  let quotesChecked = 0;
  let quotesUnverified = 0;
  let confidenceDowngraded = 0;

  for (const finding of findings) {
    const target = finding.title ?? finding.statement;

    const keptAnchors: string[] = [];
    for (const anchorId of finding.anchors) {
      anchorsChecked += 1;
      if (!evidenceById.has(anchorId)) {
        anchorsStripped += 1;
        issues.push({
          kind: "unknown-anchor",
          pass: options.pass,
          target,
          detail: `anchor not in the anchor registry: ${anchorId}`,
        });
        continue;
      }
      if (options.seenAnchors !== undefined && !options.seenAnchors.has(anchorId)) {
        anchorsStripped += 1;
        issues.push({
          kind: "new-anchor",
          pass: options.pass,
          target,
          detail: `anchor was never verified in an earlier pass: ${anchorId}`,
        });
        continue;
      }
      keptAnchors.push(anchorId);
    }

    if (keptAnchors.length === 0) {
      findingsStripped += 1;
      issues.push({
        kind: "finding-unanchored",
        pass: options.pass,
        target,
        detail: "no anchors survived verification — finding removed",
      });
      continue;
    }

    const snippetText = keptAnchors.map((id) => evidenceById.get(id)?.snippet ?? "").join("\n");
    const claimText = `${finding.title ?? ""}\n${finding.statement}`;
    let downgrade = false;

    for (const number of collectNumbers(claimText)) {
      numbersChecked += 1;
      if (
        containsNumber(engineNumberText, number) ||
        containsNumber(context.taskPack.goal, number) ||
        containsNumber(snippetText, number)
      ) {
        continue;
      }
      numbersUnverified += 1;
      downgrade = true;
      issues.push({
        kind: "number-unverified",
        pass: options.pass,
        target,
        detail: `number not traceable to engine metrics, the goal, or cited snippets: ${number}`,
      });
    }

    const normalizedSnippets = normalizeWhitespace(snippetText);
    for (const quote of collectQuotes(claimText)) {
      quotesChecked += 1;
      if (normalizedSnippets.includes(normalizeWhitespace(quote))) continue;
      quotesUnverified += 1;
      downgrade = true;
      issues.push({
        kind: "quote-unverified",
        pass: options.pass,
        target,
        detail: `quoted fragment not found in cited snippets: ${quote.slice(0, 80)}`,
      });
    }

    if (downgrade && finding.confidence !== "unknown") {
      confidenceDowngraded += 1;
      kept.push({ ...finding, anchors: keptAnchors, confidence: "unknown" });
    } else {
      kept.push({ ...finding, anchors: keptAnchors });
    }
  }

  const stats: VerifyStats = {
    findingsChecked: findings.length,
    findingsStripped,
    anchorsChecked,
    anchorsStripped,
    numbersChecked,
    numbersUnverified,
    quotesChecked,
    quotesUnverified,
    confidenceDowngraded,
  };
  return { findings: kept, issues, stats };
}

/** Outcome of verifying the final report. */
export interface VerifiedReport {
  readonly report: SynthesizeOutput;
  readonly issues: readonly VerifyIssue[];
  readonly stats: VerifyStats;
}

/**
 * Verify the `synthesize` report against the anchor registry + anchors seen in earlier passes.
 *
 * When every finding is stripped, the verdict is forced to `insufficient_evidence` — the report
 * may not claim a review outcome that no verified finding supports.
 */
export function verifySynthesizeReport(
  context: ReviewContext,
  report: SynthesizeOutput,
  seenAnchors: ReadonlySet<string>,
  allAnchors?: readonly EvidenceAnchor[],
): VerifiedReport {
  const verified = verifyFindings(context, report.findings, {
    pass: "synthesize",
    seenAnchors,
    ...(allAnchors === undefined ? {} : { allAnchors }),
  });
  const issues = [...verified.issues];
  let verdict = report.verdict;
  if (report.findings.length > 0 && verified.findings.length === 0) {
    verdict = "insufficient_evidence";
    issues.push({
      kind: "verdict-downgraded",
      pass: "synthesize",
      target: "verdict",
      detail: `all ${report.findings.length} findings were stripped — verdict forced to insufficient_evidence`,
    });
  }
  return {
    report: { ...report, verdict, findings: [...verified.findings] },
    issues,
    stats: verified.stats,
  };
}

function collectNumbers(text: string): Set<string> {
  return new Set(text.match(NUMBER_PATTERN) ?? []);
}

function collectQuotes(text: string): Set<string> {
  const quotes = new Set<string>();
  for (const match of text.matchAll(QUOTE_PATTERN)) {
    const quote = match[1];
    if (quote !== undefined) quotes.add(quote);
  }
  return quotes;
}

/**
 * Token-boundary search: `75` must not match inside `0.75` or `175`, so re-expressed values get
 * flagged instead of passing as equal.
 */
function containsNumber(text: string, number: string): boolean {
  const escaped = number.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![\\d.])${escaped}(?![\\d.])`, "u").test(text);
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

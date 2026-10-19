import type { DigestBundle, SynthesizeOutput } from "@silentskip/contracts";
import type { AiError } from "./errors.js";
import type { StructuredFindings } from "./passes/digest-step.js";

/**
 * Deterministic fallback report (E4.4).
 *
 * When the AI is unavailable (timeout, no key, HTTP error, drifted output), the run must still
 * end with an honest, engine-grounded answer instead of a flaky failure: the UI never depends
 * on the model being up. The fallback states exactly what happened, summarises the A/B change
 * from engine-computed stats, and claims nothing that was not computed by the engine.
 */

/** The fallback report plus the reason it was served. */
export interface FallbackReport {
  readonly report: SynthesizeOutput;
  readonly reason: string;
}

/**
 * Build the deterministic fallback report for a digest. Pure — same digest + error, same
 * report — and deliberately minimal: no findings (no model ran), verdict `insufficient_evidence`
 * (honest), the change summary straight from `digest.stats`.
 */
export function buildFallbackReport(digest: DigestBundle, error: AiError): FallbackReport {
  const { stats } = digest;
  const reason = `AI review unavailable (${error.code}): ${error.message}`;
  return {
    reason,
    report: {
      verdict: "insufficient_evidence",
      qualityScore: 0,
      executiveSummary:
        `AI review unavailable (${error.code}). Deterministic summary of the A/B change: ` +
        `${stats.filesChanged} files changed — ${stats.scriptFilesChanged} scripts, ` +
        `${stats.tableFilesChanged} tables; symbols +${stats.symbolsAdded}/−${stats.symbolsRemoved}/` +
        `~${stats.symbolsChanged}; rows +${stats.rowsAdded}/−${stats.rowsRemoved}/~${stats.rowsChanged}.`,
      topConcerns: [],
      themes: [],
      findings: [],
      recommendedTests: [],
      unknowns: [reason],
    },
  };
}

/** Input of a partial report — the readings that survived, plus why the run is partial. */
export interface PartialReportInput {
  readonly digest: DigestBundle;
  readonly structured: StructuredFindings;
  /** Human-readable reason the report is partial — surfaced as the run's `degradedReason`. */
  readonly reason: string;
}

/**
 * Partial report (Phase 1 / E4): the run kept its readings but never synthesised a report — the
 * AI timed out, the process was interrupted, or the user cancelled.
 *
 * The findings are lifted from the merged readings exactly as the linker verified them; nothing
 * is added, because `consequence` and `recommendation` are the synthesizer's job and no
 * synthesizer finished. Honest by construction: verdict `insufficient_evidence`, score 0, and
 * the reason recorded both as a final unknown and as `degradedReason`. Pure and deterministic.
 */
export function buildPartialReport(input: PartialReportInput): FallbackReport {
  const { stats } = input.digest;
  return {
    reason: input.reason,
    report: {
      verdict: "insufficient_evidence",
      qualityScore: 0,
      executiveSummary:
        `${input.reason} Readings completed up to that point are listed below. ` +
        `Deterministic summary of the A/B change: ` +
        `${stats.filesChanged} files changed — ${stats.scriptFilesChanged} scripts, ` +
        `${stats.tableFilesChanged} tables; symbols +${stats.symbolsAdded}/−${stats.symbolsRemoved}/` +
        `~${stats.symbolsChanged}; rows +${stats.rowsAdded}/−${stats.rowsRemoved}/~${stats.rowsChanged}.`,
      topConcerns: [],
      themes: [],
      findings: input.structured.findings.map((finding) => ({
        title: finding.title,
        statement: finding.statement,
        anchors: [...finding.anchors],
        severity: finding.severity,
        confidence: finding.confidence,
        claims: finding.claims.map((claim) => ({ ...claim })),
      })),
      recommendedTests: [],
      unknowns: [...input.structured.unknowns, input.reason],
    },
  };
}

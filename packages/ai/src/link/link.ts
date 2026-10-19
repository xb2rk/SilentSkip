import type {
  SynthesizeOutput,
  ThemeNarrative,
  TypedClaim,
  WhatIfAnswer,
  WhatIfEvidence,
  WhatIfOutput,
} from "@silentskip/contracts";
import {
  evaluateClaim,
  type FactIndex,
  findFreeNumbers,
  renderStatement,
} from "../facts/fact-index.js";
import type { LinkableFinding, LinkIssue, LinkPass, LinkStats } from "./types.js";

/**
 * The linker (E7.2, decision #28) — the compiler-like gate every model output passes through.
 *
 * Checks, all machine arithmetic over the fact index:
 * - every anchor id exists in the full registry (and, for `synthesize`, was already seen);
 * - statement placeholders resolve to real fact ids (unknown fact ⇒ finding stripped);
 * - digits outside placeholders and allowed literals are rejected (free-number ⇒ stripped);
 * - typed claims type-check and evaluate true (invalid/false ⇒ the finding is killed);
 * - quoted text (≥8 chars) must appear in a cited snippet (violation ⇒ confidence downgraded);
 * - report themes must name the engine theme ids exactly once.
 *
 * Nothing here is keyword- or semantic-based: a number either has a fact behind it or the claim
 * does not ship. Every decision is recorded as a `LinkIssue` + counters.
 */

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

/** All-zero counters — the starting point of every link run. */
export function emptyLinkStats(): LinkStats {
  return {
    findingsChecked: 0,
    findingsStripped: 0,
    anchorsChecked: 0,
    anchorsStripped: 0,
    numbersChecked: 0,
    numbersUnverified: 0,
    quotesChecked: 0,
    quotesUnverified: 0,
    confidenceDowngraded: 0,
  };
}

/** Adds two counter sets (used to aggregate the per-unit read passes). */
export function addLinkStats(a: LinkStats, b: LinkStats): LinkStats {
  return {
    findingsChecked: a.findingsChecked + b.findingsChecked,
    findingsStripped: a.findingsStripped + b.findingsStripped,
    anchorsChecked: a.anchorsChecked + b.anchorsChecked,
    anchorsStripped: a.anchorsStripped + b.anchorsStripped,
    numbersChecked: a.numbersChecked + b.numbersChecked,
    numbersUnverified: a.numbersUnverified + b.numbersUnverified,
    quotesChecked: a.quotesChecked + b.quotesChecked,
    quotesUnverified: a.quotesUnverified + b.quotesUnverified,
    confidenceDowngraded: a.confidenceDowngraded + b.confidenceDowngraded,
  };
}

const QUOTE_PATTERN = /"([^"]{8,})"/gu;

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

/** Options of `linkReport`. */
export interface LinkReportOptions {
  /** Every anchor the reading flow verified — synthesize may not add new ones. */
  readonly seenAnchors: ReadonlySet<string>;
  /** Engine theme ids the report must narrate, each exactly once. */
  readonly themeIds: readonly string[];
}

/** Result of linking a full synthesize report. */
export interface LinkReportResult {
  readonly report: SynthesizeOutput;
  readonly issues: LinkIssue[];
  readonly stats: LinkStats;
}

/** Placeholder shown when a summary text is blocked by a linker violation. */
const BLOCKED_SUMMARY =
  "[summary blocked — it contained numbers without fact sources; see verification issues]";

/**
 * Links the final report: findings via {@link linkFindings} (no new anchors), theme narratives
 * and the free-text summary fields through the same placeholder/free-number rules. All-stripped
 * findings force the verdict to `insufficient_evidence` — honesty over optimism.
 */
export function linkReport(
  report: SynthesizeOutput,
  index: FactIndex,
  options: LinkReportOptions,
): LinkReportResult {
  const themeIds = options.themeIds;
  const themeLiterals = [...themeIds];
  const linked = linkFindings(report.findings, index, {
    pass: "synthesize",
    seenAnchors: options.seenAnchors,
    extraLiterals: themeLiterals,
  });
  const issues: LinkIssue[] = [...linked.issues];
  let numbersChecked = linked.stats.numbersChecked;
  let numbersUnverified = linked.stats.numbersUnverified;

  const themeIdSet = new Set(themeIds);
  const narrated = new Set<string>();
  const themes: ThemeNarrative[] = [];
  const renderThemeText = (text: string, themeId: string, field: string): string | undefined => {
    const rendered = renderStatement(text, index);
    numbersChecked += rendered.factIds.length;
    if (rendered.unknownIds.length > 0) {
      numbersUnverified += rendered.unknownIds.length;
      issues.push({
        kind: "unknown-fact",
        pass: "synthesize",
        target: themeId,
        detail: `${field} cites unknown fact id(s): ${rendered.unknownIds.join(", ")}`,
      });
      return undefined;
    }
    const freeNumbers = findFreeNumbers(text, index, themeLiterals);
    if (freeNumbers.length > 0) {
      numbersUnverified += freeNumbers.length;
      issues.push({
        kind: "free-number",
        pass: "synthesize",
        target: themeId,
        detail: `${field} number(s) without a fact source: ${freeNumbers.slice(0, 5).join(", ")}`,
      });
      return undefined;
    }
    return rendered.text;
  };
  for (const theme of report.themes) {
    if (!themeIdSet.has(theme.themeId) || narrated.has(theme.themeId)) {
      issues.push({
        kind: "theme-invalid",
        pass: "synthesize",
        target: theme.themeId,
        detail: themeIdSet.has(theme.themeId)
          ? "theme narrated more than once"
          : "unknown theme id (not in the engine partition)",
      });
      continue;
    }
    const summary = renderThemeText(theme.summary, theme.themeId, "summary");
    const behaviorChange = renderThemeText(theme.behaviorChange, theme.themeId, "behaviorChange");
    const watchFor = renderThemeText(theme.watchFor, theme.themeId, "watchFor");
    const anchorIds = theme.anchorIds.filter((anchorId) => {
      if (index.anchors.has(anchorId)) return true;
      issues.push({
        kind: "theme-invalid",
        pass: "synthesize",
        target: theme.themeId,
        detail: `narrative anchor not in the registry: ${anchorId}`,
      });
      return false;
    });
    if (summary === undefined || behaviorChange === undefined || watchFor === undefined) {
      continue;
    }
    narrated.add(theme.themeId);
    themes.push({ themeId: theme.themeId, summary, behaviorChange, watchFor, anchorIds });
  }
  for (const themeId of themeIds) {
    if (!narrated.has(themeId)) {
      issues.push({
        kind: "theme-invalid",
        pass: "synthesize",
        target: themeId,
        detail: "theme narrative missing",
      });
    }
  }

  const scanned = scanTexts(report, index, themeLiterals);
  numbersChecked += scanned.numbersChecked;
  numbersUnverified += scanned.numbersUnverified;
  issues.push(...scanned.issues);

  const hadFindings = report.findings.length > 0;
  const findings = linked.findings;
  const verdict =
    hadFindings && findings.length === 0
      ? (() => {
          issues.push({
            kind: "verdict-downgraded",
            pass: "synthesize",
            target: "verdict",
            detail:
              "every finding was stripped by the linker; the verdict was forced to insufficient_evidence",
          });
          return "insufficient_evidence" as const;
        })()
      : report.verdict;

  return {
    report: {
      verdict,
      qualityScore: report.qualityScore,
      executiveSummary: scanned.executiveSummary,
      topConcerns: scanned.topConcerns,
      themes,
      findings,
      recommendedTests: scanned.recommendedTests,
      unknowns: scanned.unknowns,
    },
    issues,
    stats: {
      ...linked.stats,
      numbersChecked,
      numbersUnverified,
    },
  };
}

/** Free-text fields of a report scanned under the same rules (violations strip the item). */
function scanTexts(
  report: SynthesizeOutput,
  index: FactIndex,
  themeLiterals: readonly string[],
): {
  readonly executiveSummary: string;
  readonly topConcerns: string[];
  readonly recommendedTests: string[];
  readonly unknowns: string[];
  readonly issues: LinkIssue[];
  readonly numbersChecked: number;
  readonly numbersUnverified: number;
} {
  const issues: LinkIssue[] = [];
  let numbersChecked = 0;
  let numbersUnverified = 0;

  const renderAndScan = (
    text: string,
    target: string,
  ): { readonly text: string; readonly blocked: boolean } => {
    const rendered = renderStatement(text, index);
    numbersChecked += rendered.factIds.length;
    if (rendered.unknownIds.length > 0) {
      numbersUnverified += rendered.unknownIds.length;
      issues.push({
        kind: "unknown-fact",
        pass: "synthesize",
        target,
        detail: `text cites unknown fact id(s): ${rendered.unknownIds.join(", ")}`,
      });
      return { text: BLOCKED_SUMMARY, blocked: true };
    }
    const freeNumbers = findFreeNumbers(text, index, themeLiterals);
    if (freeNumbers.length > 0) {
      numbersUnverified += freeNumbers.length;
      issues.push({
        kind: "free-number",
        pass: "synthesize",
        target,
        detail: `number(s) without a fact source: ${freeNumbers.slice(0, 5).join(", ")}`,
      });
      return { text: BLOCKED_SUMMARY, blocked: true };
    }
    return { text: rendered.text, blocked: false };
  };

  const summary = renderAndScan(report.executiveSummary, "executiveSummary");
  const concerns: string[] = [];
  for (const concern of report.topConcerns) {
    const scanned = renderAndScan(concern, "topConcerns");
    if (!scanned.blocked) concerns.push(scanned.text);
  }
  const tests: string[] = [];
  for (const test of report.recommendedTests) {
    const scanned = renderAndScan(test, "recommendedTests");
    if (!scanned.blocked) tests.push(scanned.text);
  }
  const unknowns: string[] = [];
  for (const unknown of report.unknowns) {
    const scanned = renderAndScan(unknown, "unknowns");
    if (!scanned.blocked) unknowns.push(scanned.text);
  }

  return {
    executiveSummary: summary.text,
    topConcerns: concerns,
    recommendedTests: tests,
    unknowns,
    issues,
    numbersChecked,
    numbersUnverified,
  };
}

function collectQuoteViolations(
  text: string,
  anchors: readonly string[],
  index: FactIndex,
): string[] {
  const snippets = anchors
    .map((anchorId) => index.anchors.get(anchorId)?.snippet ?? "")
    .map(normalizeWhitespace)
    .join("\n");
  const violations: string[] = [];
  for (const match of text.matchAll(QUOTE_PATTERN)) {
    const quote = match[1];
    if (quote === undefined) continue;
    if (!snippets.includes(normalizeWhitespace(quote))) violations.push(quote);
  }
  return violations;
}

function countQuotes(text: string): number {
  return [...text.matchAll(QUOTE_PATTERN)].length;
}

/** Whitespace normalization used by quote checks. */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/** Result of linking one What-If answer — violations demote content, never silently drop it. */
export interface LinkAnswerResult {
  readonly answer: WhatIfAnswer;
  readonly issues: LinkIssue[];
  readonly stats: LinkStats;
}

const UNVERIFIED_SUFFIX = " (số liệu chưa truy được về fact nguồn)";

/**
 * Link one What-If answer: numbers must come from fact placeholders, every evidence statement
 * must cite registry anchors, quotes must appear in the cited snippets. Violations stay visible —
 * a demoted evidence statement moves to "speculation", prose keeps an explicit note, and every
 * demotion is recorded as an issue.
 */
export function linkAnswer(output: WhatIfOutput, index: FactIndex): LinkAnswerResult {
  const issues: LinkIssue[] = [];
  let findingsChecked = 0;
  let findingsStripped = 0;
  let anchorsChecked = 0;
  let anchorsStripped = 0;
  let numbersChecked = 0;
  let numbersUnverified = 0;
  let quotesChecked = 0;
  let quotesUnverified = 0;

  const answerRendered = renderStatement(output.answer, index);
  numbersChecked += answerRendered.factIds.length;
  if (answerRendered.unknownIds.length > 0) {
    issues.push({
      kind: "unknown-fact",
      pass: "whatif",
      target: "answer",
      detail: `answer cites unknown fact id(s): ${answerRendered.unknownIds.slice(0, 5).join(", ")}`,
    });
    numbersUnverified += answerRendered.unknownIds.length;
  }
  const answerFreeNumbers = findFreeNumbers(output.answer, index);
  if (answerFreeNumbers.length > 0) {
    issues.push({
      kind: "free-number",
      pass: "whatif",
      target: "answer",
      detail: `answer number(s) without a fact source: ${answerFreeNumbers.slice(0, 5).join(", ")}`,
    });
    numbersUnverified += answerFreeNumbers.length;
  }
  const answerHasViolations = answerRendered.unknownIds.length > 0 || answerFreeNumbers.length > 0;
  const answerText = sanitizeUnknownFacts(
    answerHasViolations ? `${answerRendered.text}${UNVERIFIED_SUFFIX}` : answerRendered.text,
  );

  const demoted: string[] = [];
  const evidence: WhatIfEvidence[] = [];
  for (const item of output.evidence) {
    findingsChecked += 1;
    anchorsChecked += item.anchors.length;
    const unknownAnchors = item.anchors.filter((anchorId) => !index.anchors.has(anchorId));
    const anchors = item.anchors.filter((anchorId) => index.anchors.has(anchorId));
    if (unknownAnchors.length > 0) {
      anchorsStripped += unknownAnchors.length;
      issues.push({
        kind: "unknown-anchor",
        pass: "whatif",
        target: item.statement.slice(0, 80),
        detail: `anchor not in the anchor registry: ${unknownAnchors.slice(0, 5).join(", ")}`,
      });
    }
    const rendered = renderStatement(item.statement, index);
    numbersChecked += rendered.factIds.length;
    let grounded = anchors.length > 0;
    if (!grounded) {
      issues.push({
        kind: "finding-unanchored",
        pass: "whatif",
        target: item.statement.slice(0, 80),
        detail: "evidence statement cites no anchor that exists in the registry",
      });
      findingsStripped += 1;
    }
    if (rendered.unknownIds.length > 0) {
      issues.push({
        kind: "unknown-fact",
        pass: "whatif",
        target: item.statement.slice(0, 80),
        detail: `cites unknown fact id(s): ${rendered.unknownIds.slice(0, 5).join(", ")}`,
      });
      numbersUnverified += rendered.unknownIds.length;
      grounded = false;
    }
    const freeNumbers = findFreeNumbers(item.statement, index);
    if (freeNumbers.length > 0) {
      issues.push({
        kind: "free-number",
        pass: "whatif",
        target: item.statement.slice(0, 80),
        detail: `number(s) without a fact source: ${freeNumbers.slice(0, 5).join(", ")}`,
      });
      numbersUnverified += freeNumbers.length;
      grounded = false;
    }
    if (grounded) evidence.push({ statement: rendered.text, anchors });
    else demoted.push(rendered.text);
  }

  const speculation: string[] = [];
  for (const item of output.speculation) {
    const linked = linkProse(item, "speculation", index, issues);
    numbersChecked += linked.factCount;
    speculation.push(linked.text);
  }
  for (const item of demoted) speculation.push(withUnverifiedSuffix(item, index, issues));

  const unknowns: string[] = [];
  for (const item of output.unknowns) {
    const linked = linkProse(item, "unknowns", index, issues);
    numbersChecked += linked.factCount;
    unknowns.push(linked.text);
  }

  const citedAnchors = [...new Set(evidence.flatMap((item) => item.anchors))];
  const quoteViolations = collectQuoteViolations(answerRendered.text, citedAnchors, index);
  quotesChecked += countQuotes(answerRendered.text);
  if (quoteViolations.length > 0) {
    quotesUnverified += quoteViolations.length;
    issues.push({
      kind: "quote-unverified",
      pass: "whatif",
      target: "answer",
      detail: `quote(s) not found in the cited snippets: ${quoteViolations.slice(0, 3).join(" | ")}`,
    });
  }

  return {
    answer: { answer: answerText, evidence, speculation, unknowns, pinsUsed: [] },
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
      confidenceDowngraded: 0,
    },
  };
}

/** Non-fact prose keeps free numbers but gains an explicit note + an issue (never silent). */
function withUnverifiedSuffix(
  text: string,
  index: FactIndex,
  issues: LinkIssue[],
  source: string = text,
): string {
  const freeNumbers = findFreeNumbers(source, index);
  if (freeNumbers.length === 0) return text;
  issues.push({
    kind: "free-number",
    pass: "whatif",
    target: "prose",
    detail: `number(s) without a fact source: ${freeNumbers.slice(0, 5).join(", ")}`,
  });
  return `${text}${UNVERIFIED_SUFFIX}`;
}

const LEFTOVER_PLACEHOLDER = /\{\{f:[^}]+\}\}/gu;

/** Unknown fact placeholders are kept raw for diagnosis; persisted prose gets a readable mark. */
function sanitizeUnknownFacts(text: string): string {
  return text.replace(LEFTOVER_PLACEHOLDER, "(fact không tồn tại)");
}

/**
 * Links free prose (speculation/unknowns): placeholders render like findings do, unknown ids are
 * reported, and any free number keeps its explicit note. Numbers are checked on the raw source so
 * engine-filled values are never mistaken for model-invented numbers.
 */
function linkProse(
  text: string,
  target: string,
  index: FactIndex,
  issues: LinkIssue[],
): { readonly text: string; readonly factCount: number } {
  const rendered = renderStatement(text, index);
  if (rendered.unknownIds.length > 0) {
    issues.push({
      kind: "unknown-fact",
      pass: "whatif",
      target,
      detail: `cites unknown fact id(s): ${rendered.unknownIds.slice(0, 5).join(", ")}`,
    });
  }
  const linked = withUnverifiedSuffix(rendered.text, index, issues, text);
  return { text: sanitizeUnknownFacts(linked), factCount: rendered.factIds.length };
}

import type { SynthesizeOutput, ThemeNarrative } from "@silentskip/contracts";
import { type FactIndex, findFreeNumbers, renderStatement } from "../facts/fact-index.js";
import { linkFindings } from "./findings.js";
import type { LinkIssue, LinkStats } from "./types.js";

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
      if (!index.anchors.has(anchorId)) {
        issues.push({
          kind: "theme-invalid",
          pass: "synthesize",
          target: theme.themeId,
          detail: `narrative anchor not in the registry: ${anchorId}`,
        });
        return false;
      }
      // Same rule as findings: a narrative may only cite evidence the readings actually reached.
      // Theme file membership is not enforced — an anchor from an unchanged context file is a
      // legitimate reference to the loader or caller that explains the change.
      if (!options.seenAnchors.has(anchorId)) {
        issues.push({
          kind: "new-anchor",
          pass: "synthesize",
          target: theme.themeId,
          detail: `narrative anchor was never cited by the readings: ${anchorId}`,
        });
        return false;
      }
      return true;
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

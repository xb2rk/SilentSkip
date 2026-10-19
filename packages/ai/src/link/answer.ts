import type { WhatIfAnswer, WhatIfEvidence, WhatIfOutput } from "@silentskip/contracts";
import { type FactIndex, findFreeNumbers, renderStatement } from "../facts/fact-index.js";
import { collectQuoteViolations, countQuotes } from "./quotes.js";
import type { LinkIssue, LinkStats } from "./types.js";

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

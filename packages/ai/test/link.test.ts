import type { SynthesizeOutput } from "@craftland-qa/contracts";
import { describe, expect, it } from "vitest";
import {
  addLinkStats,
  buildFactIndex,
  emptyLinkStats,
  linkFindings,
  linkReport,
} from "../src/index";
import {
  ANCHOR_A_ATK,
  ANCHOR_A_MOD,
  ANCHOR_B_ATK,
  ANCHOR_B_MOD,
  makeDigest,
} from "./helpers/digest-fixture";

const INDEX = buildFactIndex(makeDigest());
const Q_MOD_A = "q:value|A|Assets/Scripts/Config.fcg|_MOD";
const Q_MOD_B = "q:value|B|Assets/Scripts/Config.fcg|_MOD";

function finding(
  over: Partial<SynthesizeOutput["findings"][number]> = {},
): SynthesizeOutput["findings"][number] {
  return {
    title: "Change",
    statement: "The behavior changed",
    anchors: [ANCHOR_B_ATK],
    severity: "major",
    confidence: "exact",
    claims: [],
    ...over,
  };
}

function makeReport(
  findings: SynthesizeOutput["findings"],
  themes: SynthesizeOutput["themes"] = [],
): SynthesizeOutput {
  return {
    verdict: "needs_review",
    qualityScore: 75,
    executiveSummary: "One change.",
    topConcerns: [],
    themes,
    findings,
    recommendedTests: [],
    unknowns: [],
  };
}

describe("linkFindings", () => {
  it("renders placeholders from the fact store", () => {
    const result = linkFindings(
      [finding({ statement: `_MOD moved from {{f:${Q_MOD_A}}} to {{f:${Q_MOD_B}}}` })],
      INDEX,
      { pass: "read" },
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.statement).toContain("104729");
    expect(result.findings[0]?.statement).toContain("999983");
    expect(result.stats.numbersChecked).toBe(2);
    expect(result.issues).toEqual([]);
  });

  it("strips unknown anchors and keeps the rest", () => {
    const result = linkFindings(
      [finding({ anchors: [ANCHOR_B_ATK, "B:ghost.fcg:9:9:code"] })],
      INDEX,
      {
        pass: "read",
      },
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.anchors).toEqual([ANCHOR_B_ATK]);
    expect(result.issues.map((issue) => issue.kind)).toEqual(["unknown-anchor"]);
    expect(result.stats.anchorsStripped).toBe(1);
  });

  it("removes findings whose anchors all failed", () => {
    const result = linkFindings([finding({ anchors: ["B:ghost.fcg:9:9:code"] })], INDEX, {
      pass: "read",
    });
    expect(result.findings).toHaveLength(0);
    expect(result.stats.findingsStripped).toBe(1);
    expect(result.issues.map((issue) => issue.kind)).toEqual([
      "unknown-anchor",
      "finding-unanchored",
    ]);
  });

  it("rejects anchors never seen by the reading flow", () => {
    const result = linkFindings([finding({ anchors: [ANCHOR_B_ATK] })], INDEX, {
      pass: "synthesize",
      seenAnchors: new Set([ANCHOR_A_ATK]),
    });
    expect(result.findings).toHaveLength(0);
    expect(result.issues.map((issue) => issue.kind)).toEqual(["new-anchor", "finding-unanchored"]);
  });

  it("strips statements with free numbers", () => {
    const result = linkFindings([finding({ statement: "atk changed from 100 to 120" })], INDEX, {
      pass: "read",
    });
    expect(result.findings).toHaveLength(0);
    expect(result.issues.map((issue) => issue.kind)).toEqual(["free-number"]);
  });

  it("allows digits inside anchor ids and file names", () => {
    const result = linkFindings(
      [finding({ statement: `cite ${ANCHOR_B_ATK} for the change` })],
      INDEX,
      { pass: "read" },
    );
    expect(result.findings).toHaveLength(1);
  });

  it("evaluates typed claims itself — false and invalid claims kill the finding", () => {
    const differs = linkFindings(
      [finding({ claims: [{ subject: Q_MOD_A, relation: "differs", object: Q_MOD_B }] })],
      INDEX,
      { pass: "read" },
    );
    expect(differs.findings).toHaveLength(1);
    expect(differs.findings[0]?.claims).toHaveLength(1);

    const equals = linkFindings(
      [finding({ claims: [{ subject: Q_MOD_A, relation: "equals", object: Q_MOD_B }] })],
      INDEX,
      { pass: "read" },
    );
    expect(equals.findings).toHaveLength(0);
    expect(equals.issues.map((issue) => issue.kind)).toEqual(["claim-false"]);

    const invalid = linkFindings(
      [finding({ claims: [{ subject: "q:nope", relation: "equals", object: Q_MOD_B }] })],
      INDEX,
      { pass: "read" },
    );
    expect(invalid.findings).toHaveLength(0);
    expect(invalid.issues.map((issue) => issue.kind)).toEqual(["claim-invalid"]);
  });

  it("downgrades confidence when a quote is not in the cited snippets", () => {
    const result = linkFindings(
      [finding({ statement: 'value shows "totally fabricated text"' })],
      INDEX,
      { pass: "read" },
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.confidence).toBe("unknown");
    expect(result.issues.map((issue) => issue.kind)).toEqual(["quote-unverified"]);
    expect(result.stats.confidenceDowngraded).toBe(1);
  });

  it("keeps quotes that appear in the cited snippets", () => {
    const result = linkFindings([finding({ statement: 'row "scout,120" changed' })], INDEX, {
      pass: "read",
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.confidence).toBe("exact");
    expect(result.stats.quotesUnverified).toBe(0);
  });

  it("is deterministic", () => {
    const run = () =>
      linkFindings(
        [
          finding({
            statement: `{{f:${Q_MOD_B}}}`,
            claims: [{ subject: Q_MOD_A, relation: "differs", object: Q_MOD_B }],
          }),
        ],
        INDEX,
        { pass: "read" },
      );
    expect(run()).toEqual(run());
  });
});

describe("linkReport", () => {
  it("validates theme narratives — unknown, duplicate and missing ids", () => {
    const result = linkReport(
      makeReport(
        [finding()],
        [
          { themeId: "theme-1", narrative: "ok" },
          { themeId: "theme-1", narrative: "dupe" },
          { themeId: "theme-9", narrative: "unknown" },
        ],
      ),
      INDEX,
      { seenAnchors: new Set([ANCHOR_B_ATK]), themeIds: ["theme-1", "theme-2"] },
    );
    expect(result.report.themes).toEqual([{ themeId: "theme-1", narrative: "ok" }]);
    expect(result.issues.filter((issue) => issue.kind === "theme-invalid")).toHaveLength(3);
  });

  it("renders placeholders in narratives and drops narratives with free numbers", () => {
    const result = linkReport(
      makeReport(
        [finding()],
        [
          { themeId: "theme-1", narrative: `value {{f:${Q_MOD_B}}}` },
          { themeId: "theme-2", narrative: "changed 17 columns" },
        ],
      ),
      INDEX,
      { seenAnchors: new Set([ANCHOR_B_ATK]), themeIds: ["theme-1", "theme-2"] },
    );
    expect(result.report.themes).toEqual([{ themeId: "theme-1", narrative: "value 999983" }]);
    expect(result.issues.some((issue) => issue.kind === "free-number")).toBe(true);
  });

  it("blocks a summary that carries numbers without fact sources", () => {
    const report = makeReport([finding()]);
    report.executiveSummary = "The loader now expects 17 columns.";
    const result = linkReport(report, INDEX, {
      seenAnchors: new Set([ANCHOR_B_ATK]),
      themeIds: [],
    });
    expect(result.report.executiveSummary).toContain("blocked");
    expect(result.issues.some((issue) => issue.kind === "free-number")).toBe(true);
  });

  it("forces insufficient_evidence when every finding was stripped", () => {
    const result = linkReport(
      makeReport([finding({ anchors: [ANCHOR_A_MOD, ANCHOR_B_MOD] })]),
      INDEX,
      {
        seenAnchors: new Set([ANCHOR_B_ATK]),
        themeIds: [],
      },
    );
    expect(result.report.findings).toHaveLength(0);
    expect(result.report.verdict).toBe("insufficient_evidence");
    expect(result.issues.some((issue) => issue.kind === "verdict-downgraded")).toBe(true);
  });

  it("keeps verified findings and verdicts untouched", () => {
    const result = linkReport(makeReport([finding()]), INDEX, {
      seenAnchors: new Set([ANCHOR_B_ATK]),
      themeIds: [],
    });
    expect(result.report.verdict).toBe("needs_review");
    expect(result.report.findings).toHaveLength(1);
    expect(result.issues).toEqual([]);
  });
});

describe("link stats", () => {
  it("adds and starts at zero", () => {
    const zero = emptyLinkStats();
    expect(zero.findingsChecked).toBe(0);
    const sum = addLinkStats({ ...zero, findingsChecked: 2 }, { ...zero, findingsChecked: 3 });
    expect(sum.findingsChecked).toBe(5);
  });
});

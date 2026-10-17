import type { SynthesizeOutput } from "@craftland-qa/contracts";
import { describe, expect, it } from "vitest";
import { buildReviewContext, verifyFindings, verifySynthesizeReport } from "../src/index";
import { ANCHOR_A_ATK, ANCHOR_B_ATK, ANCHOR_B_MOD, makeDigest } from "./helpers/digest-fixture";

const CONTEXT = buildReviewContext(makeDigest(), { goal: "Check the scout attack change" });

function readFinding(
  statement: string,
  anchors: string[],
  confidence: "exact" | "inferred" = "exact",
) {
  return { statement, anchors, severity: "major" as const, confidence };
}

function synthesizeFinding(
  title: string,
  statement: string,
  anchors: string[],
  confidence: "exact" | "inferred" = "exact",
) {
  return { title, statement, anchors, severity: "major" as const, confidence };
}

function makeReport(findings: SynthesizeOutput["findings"]): SynthesizeOutput {
  return {
    verdict: "needs_review",
    qualityScore: 75,
    executiveSummary: "One change.",
    topConcerns: ["atk spike"],
    findings,
    recommendedTests: [],
    unknowns: [],
  };
}

describe("verifyFindings", () => {
  it("strips unknown anchors and keeps the finding with the rest", () => {
    const result = verifyFindings(
      CONTEXT,
      [readFinding("atk spike", [ANCHOR_B_ATK, "B:Assets/CSV/Ghost.csv:9:9:csv"])],
      { pass: "digest_read" },
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.anchors).toEqual([ANCHOR_B_ATK]);
    expect(result.issues.map((issue) => issue.kind)).toEqual(["unknown-anchor"]);
    expect(result.stats.anchorsChecked).toBe(2);
    expect(result.stats.anchorsStripped).toBe(1);
    expect(result.stats.findingsStripped).toBe(0);
  });

  it("removes findings whose every anchor is unknown", () => {
    const result = verifyFindings(
      CONTEXT,
      [readFinding("ghost claim", ["B:Assets/CSV/Ghost.csv:9:9:csv"])],
      { pass: "digest_read" },
    );
    expect(result.findings).toHaveLength(0);
    expect(result.issues.map((issue) => issue.kind)).toEqual([
      "unknown-anchor",
      "finding-unanchored",
    ]);
    expect(result.stats.findingsStripped).toBe(1);
  });

  it("keeps anchors that exist in the full registry even when dropped from the evidence pack", () => {
    const registryOnly = {
      id: "B:Assets/CSV/Extra.csv:3:3:csv",
      ref: "B" as const,
      file: "Assets/CSV/Extra.csv",
      lineStart: 3,
      lineEnd: 3,
      kind: "csv" as const,
      snippet: "Extra,1",
    };
    const finding = readFinding("Extra table appeared", [registryOnly.id]);
    const packOnly = verifyFindings(CONTEXT, [finding], { pass: "digest_read" });
    expect(packOnly.findings).toHaveLength(0);
    const withRegistry = verifyFindings(CONTEXT, [finding], {
      pass: "digest_read",
      allAnchors: [...CONTEXT.evidence, registryOnly],
    });
    expect(withRegistry.findings).toHaveLength(1);
    expect(withRegistry.stats.anchorsStripped).toBe(0);
  });

  it("synthesize may not introduce anchors earlier passes never verified", () => {
    const seen = new Set([ANCHOR_B_ATK]);
    const result = verifyFindings(
      CONTEXT,
      [synthesizeFinding("atk", "atk spike", [ANCHOR_A_ATK])],
      {
        pass: "synthesize",
        seenAnchors: seen,
      },
    );
    expect(result.findings).toHaveLength(0);
    const kinds = result.issues.map((issue) => issue.kind);
    expect(kinds).toContain("new-anchor");
    expect(kinds).toContain("finding-unanchored");
    expect(result.stats.anchorsStripped).toBe(1);
  });

  it("numbers traceable to cited snippets stay exact", () => {
    const result = verifyFindings(
      CONTEXT,
      [readFinding("atk moved from 100 to 120", [ANCHOR_A_ATK, ANCHOR_B_ATK])],
      { pass: "digest_read" },
    );
    expect(result.findings[0]?.confidence).toBe("exact");
    expect(result.stats.numbersUnverified).toBe(0);
  });

  it("engine metrics are traceable", () => {
    const result = verifyFindings(
      CONTEXT,
      [readFinding("2 files changed across 1 script and 1 table", [ANCHOR_B_MOD])],
      { pass: "digest_read" },
    );
    expect(result.findings[0]?.confidence).toBe("exact");
    expect(result.stats.numbersUnverified).toBe(0);
  });

  it("untraceable numbers downgrade confidence to unknown", () => {
    const result = verifyFindings(CONTEXT, [readFinding("atk rose to 9999", [ANCHOR_B_ATK])], {
      pass: "digest_read",
    });
    expect(result.findings[0]?.confidence).toBe("unknown");
    expect(result.issues.map((issue) => issue.kind)).toEqual(["number-unverified"]);
    expect(result.stats.numbersUnverified).toBe(1);
    expect(result.stats.confidenceDowngraded).toBe(1);
  });

  it("token boundaries hold: 75 does not pass as 0.75", () => {
    const result = verifyFindings(CONTEXT, [readFinding("damage cap is 75%", [ANCHOR_B_MOD])], {
      pass: "digest_read",
    });
    expect(result.findings[0]?.confidence).toBe("unknown");
    expect(result.stats.numbersUnverified).toBe(1);
  });

  it("quoted fragments must appear in the cited snippets", () => {
    const good = verifyFindings(
      CONTEXT,
      [readFinding('row "scout,120" changed', [ANCHOR_B_ATK])],
      { pass: "digest_read" },
    );
    expect(good.findings[0]?.confidence).toBe("exact");
    expect(good.stats.quotesUnverified).toBe(0);

    const bad = verifyFindings(
      CONTEXT,
      [readFinding('value "totally fabricated" changed', [ANCHOR_B_ATK])],
      { pass: "digest_read" },
    );
    expect(bad.findings[0]?.confidence).toBe("unknown");
    expect(bad.issues.map((issue) => issue.kind)).toEqual(["quote-unverified"]);
    expect(bad.stats.quotesUnverified).toBe(1);
  });

  it("is deterministic", () => {
    const findings = [readFinding("atk rose to 9999", [ANCHOR_B_ATK])];
    expect(verifyFindings(CONTEXT, findings, { pass: "digest_read" })).toEqual(
      verifyFindings(CONTEXT, findings, { pass: "digest_read" }),
    );
  });
});

describe("verifySynthesizeReport", () => {
  it("forces insufficient_evidence when every finding is stripped", () => {
    const report = makeReport([
      synthesizeFinding("ghost", "ghost claim", ["B:Assets/CSV/Ghost.csv:9:9:csv"]),
    ]);
    const result = verifySynthesizeReport(CONTEXT, report, new Set([ANCHOR_B_ATK]));
    expect(result.report.findings).toHaveLength(0);
    expect(result.report.verdict).toBe("insufficient_evidence");
    const kinds = result.issues.map((issue) => issue.kind);
    expect(kinds).toContain("unknown-anchor");
    expect(kinds).toContain("finding-unanchored");
    expect(kinds).toContain("verdict-downgraded");
  });

  it("keeps the verdict when findings survive", () => {
    const report = makeReport([synthesizeFinding("atk", "atk spike", [ANCHOR_B_ATK])]);
    const result = verifySynthesizeReport(CONTEXT, report, new Set([ANCHOR_B_ATK]));
    expect(result.report.verdict).toBe("needs_review");
    expect(result.report.findings).toHaveLength(1);
    expect(result.issues).toHaveLength(0);
  });
});

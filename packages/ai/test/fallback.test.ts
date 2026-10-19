import { describe, expect, it } from "vitest";
import {
  AiError,
  buildFallbackReport,
  buildPartialReport,
  type StructuredFindings,
} from "../src/index";
import { ANCHOR_B_MOD, makeDigest } from "./helpers/digest-fixture";

describe("buildFallbackReport", () => {
  it("summarises the change from engine stats and stays honest about the missing AI", () => {
    const error = new AiError("not-configured", "workflow URL or API key is missing");
    const { report, reason } = buildFallbackReport(makeDigest(), error);
    expect(report.verdict).toBe("insufficient_evidence");
    expect(report.qualityScore).toBe(0);
    expect(report.findings).toEqual([]);
    expect(reason).toContain("not-configured");
    expect(report.unknowns).toEqual([reason]);
    expect(report.executiveSummary).toContain("2 files changed");
    expect(report.executiveSummary).toContain("1 scripts");
    expect(report.executiveSummary).toContain("1 tables");
    expect(report.executiveSummary).toContain("rows +0/−0/~1");
  });

  it("is deterministic", () => {
    const error = new AiError("timeout", "timed out");
    expect(buildFallbackReport(makeDigest(), error)).toEqual(
      buildFallbackReport(makeDigest(), error),
    );
  });
});

describe("buildPartialReport", () => {
  const REASON = "AI review incomplete (timeout): Insea workflow timed out after 180000ms";
  const structured: StructuredFindings = {
    findings: [
      {
        title: "Constant changed",
        statement: "The constant changed",
        anchors: [ANCHOR_B_MOD],
        severity: "major",
        confidence: "exact",
        claims: [],
      },
    ],
    unknowns: ["something unclear"],
    negativeResults: [],
    answers: [],
  };

  it("lifts the verified readings 1:1 and invents nothing", () => {
    const { report, reason } = buildPartialReport({
      digest: makeDigest(),
      structured,
      reason: REASON,
    });
    expect(reason).toBe(REASON);
    expect(report.verdict).toBe("insufficient_evidence");
    expect(report.qualityScore).toBe(0);
    expect(report.themes).toEqual([]);
    expect(report.findings).toEqual([
      {
        title: "Constant changed",
        statement: "The constant changed",
        anchors: [ANCHOR_B_MOD],
        severity: "major",
        confidence: "exact",
        claims: [],
      },
    ]);
    // `consequence`/`recommendation` are the synthesizer's job — no synthesizer finished.
    expect(report.findings[0]).not.toHaveProperty("consequence");
    expect(report.findings[0]).not.toHaveProperty("recommendation");
    expect(report.unknowns).toEqual(["something unclear", REASON]);
    expect(report.executiveSummary).toContain(REASON);
    expect(report.executiveSummary).toContain("2 files changed");
  });

  it("is deterministic", () => {
    expect(buildPartialReport({ digest: makeDigest(), structured, reason: REASON })).toEqual(
      buildPartialReport({ digest: makeDigest(), structured, reason: REASON }),
    );
  });
});

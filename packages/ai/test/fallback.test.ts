import { describe, expect, it } from "vitest";
import { AiError, buildFallbackReport } from "../src/index";
import { makeDigest } from "./helpers/digest-fixture";

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

import { describe, expect, it } from "vitest";
import { DigestReadOutputSchema, SynthesizeOutputSchema, VerdictSchema } from "../src/index";

describe("pass I/O schemas", () => {
  it("accepts a well-formed digest_read output", () => {
    const output = {
      findings: [
        {
          statement: "scout atk rises from 100 to 120",
          anchors: ["B:Assets/CSV/UnitData.csv:2:2:csv:r:scout:c:atk"],
          severity: "major",
          confidence: "exact",
        },
      ],
      unknowns: ["runtime clamp behavior is unknown"],
      negativeResults: ["no symbols removed"],
      needMore: ["UnitData reader"],
    };
    expect(DigestReadOutputSchema.parse(output)).toEqual(output);
  });

  it("rejects more than three needMore queries (no recursion by contract)", () => {
    const result = DigestReadOutputSchema.safeParse({
      findings: [],
      unknowns: [],
      negativeResults: [],
      needMore: ["a", "b", "c", "d"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a synthesize output and enforces the verdict enum and score range", () => {
    const output = {
      verdict: "needs_review",
      qualityScore: 72,
      executiveSummary: "Summary of the change.",
      topConcerns: ["attack spike in early waves"],
      findings: [
        {
          title: "Damage spike",
          statement: "scout atk rises 20%",
          anchors: ["B:Assets/CSV/UnitData.csv:2:2:csv:r:scout:c:atk"],
          severity: "major",
          confidence: "exact",
          consequence: "TTK drops in early waves",
          recommendation: "re-test wave 3 pacing",
        },
      ],
      recommendedTests: ["Play wave 3 with default loadout"],
      unknowns: [],
    };
    expect(SynthesizeOutputSchema.parse(output)).toEqual(output);
    expect(VerdictSchema.safeParse("nope").success).toBe(false);
    expect(SynthesizeOutputSchema.safeParse({ ...output, qualityScore: 101 }).success).toBe(false);
  });
});

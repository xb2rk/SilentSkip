import { describe, expect, it } from "vitest";
import {
  MapOutputSchema,
  ReadOutputSchema,
  SynthesizeOutputSchema,
  VerdictSchema,
} from "../src/index";

describe("pass I/O schemas (v2)", () => {
  it("accepts a well-formed read output with typed claims and placeholders", () => {
    const output = {
      findings: [
        {
          title: "Attack spike",
          statement:
            "scout atk rises from {{f:q:value|A|Assets/CSV/UnitData.csv|atk}} to 120",
          anchors: ["B:Assets/CSV/UnitData.csv:2:2:csv:r:scout:c:atk"],
          severity: "major",
          confidence: "exact",
          claims: [
            {
              subject: "q:value|A|Assets/CSV/UnitData.csv|atk",
              relation: "differs",
              object: "q:value|B|Assets/CSV/UnitData.csv|atk",
            },
          ],
        },
      ],
      unknowns: ["runtime clamp behavior is unknown"],
      negativeResults: ["no symbols removed"],
      needMore: ["UnitData reader"],
    };
    expect(ReadOutputSchema.parse(output)).toEqual(output);
  });

  it("defaults claims to an empty array when the model omits them", () => {
    const parsed = ReadOutputSchema.parse({
      findings: [
        {
          title: "Note",
          statement: "No numeric claim here",
          anchors: [],
          severity: "info",
          confidence: "unknown",
        },
      ],
      unknowns: [],
      negativeResults: [],
      needMore: [],
    });
    expect(parsed.findings[0]?.claims).toEqual([]);
  });

  it("rejects more than three needMore queries (no recursion by contract)", () => {
    const result = ReadOutputSchema.safeParse({
      findings: [],
      unknowns: [],
      negativeResults: [],
      needMore: ["a", "b", "c", "d"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a map output and rejects empty themes", () => {
    const output = {
      themes: [
        { name: "Combat refactor", files: ["Assets/Scripts/Server_Combat.fcg"] },
        { name: "Special enemies", files: ["Assets/CSV/SpecialUnitData.csv"] },
      ],
    };
    expect(MapOutputSchema.parse(output)).toEqual(output);
    expect(MapOutputSchema.safeParse({ themes: [] }).success).toBe(false);
    expect(MapOutputSchema.safeParse({ themes: [{ name: "Empty", files: [] }] }).success).toBe(
      false,
    );
  });

  it("accepts a synthesize output and enforces the verdict enum and score range", () => {
    const output = {
      verdict: "needs_review",
      qualityScore: 72,
      executiveSummary: "Summary of the change.",
      topConcerns: ["attack spike in early waves"],
      themes: [{ themeId: "theme-1", narrative: "Combat pacing moved earlier." }],
      findings: [
        {
          title: "Damage spike",
          statement: "scout atk changed",
          anchors: ["B:Assets/CSV/UnitData.csv:2:2:csv:r:scout:c:atk"],
          severity: "major",
          confidence: "exact",
          consequence: "TTK drops in early waves",
          recommendation: "re-test wave 3 pacing",
          claims: [
            {
              subject: "q:value|A|Assets/CSV/UnitData.csv|atk",
              relation: "differs",
              object: "q:value|B|Assets/CSV/UnitData.csv|atk",
            },
          ],
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

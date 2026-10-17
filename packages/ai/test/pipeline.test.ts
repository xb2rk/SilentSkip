import { describe, expect, it } from "vitest";
import { runReviewPipeline } from "../src/index";
import { ANCHOR_B_ATK, ANCHOR_B_MOD, makeDigest } from "./helpers/digest-fixture";
import { scriptedRunner } from "./helpers/scripted-runner";

const CONFIG = { workflowUrl: "https://example.test/run", apiKey: "k" } as const;

const READ = {
  findings: [
    { statement: "atk spike", anchors: [ANCHOR_B_ATK], severity: "major", confidence: "exact" },
  ],
  unknowns: [],
  negativeResults: [],
  needMore: ["Config.fcg"],
};

const DIG = {
  findings: [
    { statement: "mod change", anchors: [ANCHOR_B_MOD], severity: "minor", confidence: "inferred" },
  ],
  unknowns: [],
  answers: ["see Config.fcg"],
};

const REPORT = {
  verdict: "needs_review",
  qualityScore: 75,
  executiveSummary: "Two changes.",
  topConcerns: ["atk spike"],
  findings: [
    {
      title: "atk",
      statement: "atk spike",
      anchors: [ANCHOR_B_ATK],
      severity: "major",
      confidence: "exact",
    },
  ],
  recommendedTests: ["wave 3"],
  unknowns: [],
};

describe("runReviewPipeline", () => {
  it("runs digest_read → dig → synthesize and reports honest meta", async () => {
    const { runner, calls } = scriptedRunner({ digest_read: READ, dig: DIG, synthesize: REPORT });
    const result = await runReviewPipeline(
      { runner, config: CONFIG },
      { digest: makeDigest(), goal: "Pacing" },
    );
    expect(result.report).toEqual(REPORT);
    expect(result.passes.map((meta) => meta.pass)).toEqual(["digest_read", "dig", "synthesize"]);
    expect(result.structuredFindings.findings).toHaveLength(2);
    expect(result.contextManifest.counts.evidence).toBe(4);
    expect(calls.map((call) => (JSON.parse(call.manifestJson) as { stage: string }).stage)).toEqual(
      ["digest_read", "dig", "synthesize"],
    );
  });

  it("skips dig when pass 1 does not ask for more (no recursion)", async () => {
    const { runner, calls } = scriptedRunner({
      digest_read: { ...READ, needMore: [] },
      synthesize: REPORT,
    });
    const result = await runReviewPipeline({ runner, config: CONFIG }, { digest: makeDigest() });
    expect(result.passes.map((meta) => meta.pass)).toEqual(["digest_read", "synthesize"]);
    expect(calls).toHaveLength(2);
  });
});

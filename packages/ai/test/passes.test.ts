import { describe, expect, it } from "vitest";
import {
  AiError,
  buildReviewContext,
  mergeReadOutputs,
  resolveNeedMore,
  runDigestReadPass,
  runDigPass,
  runSynthesizePass,
} from "../src/index";
import { ANCHOR_A_MOD, ANCHOR_B_ATK, makeDigest } from "./helpers/digest-fixture";
import { firstCall, scriptedRunner } from "./helpers/scripted-runner";

const CONFIG = { workflowUrl: "https://example.test/run", apiKey: "k" } as const;
const context = buildReviewContext(makeDigest(), { goal: "Check pacing" });

const READ_OUTPUT = {
  findings: [
    {
      statement: "scout atk 100 → 120",
      anchors: [ANCHOR_B_ATK],
      severity: "major",
      confidence: "exact",
    },
  ],
  unknowns: ["clamp behavior unknown"],
  negativeResults: ["no symbols removed"],
  needMore: ["UnitData"],
};

describe("runDigestReadPass", () => {
  it("parses schema-valid output and reports pass meta", async () => {
    const { runner, calls } = scriptedRunner({ digest_read: READ_OUTPUT });
    const result = await runDigestReadPass({ runner, config: CONFIG }, context);
    expect(result.output).toEqual(READ_OUTPUT);
    expect(result.meta).toMatchObject({
      pass: "digest_read",
      promptVersion: "1.0.0",
      salvage: "clean",
    });
    const manifest = JSON.parse(firstCall(calls).manifestJson) as { stage: string };
    expect(manifest.stage).toBe("digest_read");
  });

  it("fails loudly with invalid-output when the model drifts", async () => {
    const { runner } = scriptedRunner({ digest_read: { findings: "nope" } });
    const error = await runDigestReadPass({ runner, config: CONFIG }, context).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AiError);
    expect(error).toMatchObject({ code: "invalid-output" });
  });
});

describe("resolveNeedMore + runDigPass", () => {
  it("resolves queries to exact anchors deterministically", () => {
    const focused = resolveNeedMore(context, ["UnitData", "Config.fcg", "   "]);
    expect(focused.queries).toEqual(["UnitData", "Config.fcg"]);
    const ids = focused.anchors.map((anchor) => anchor.id);
    expect(ids).toContain(ANCHOR_B_ATK);
    expect(ids).toContain(ANCHOR_A_MOD);
    expect(resolveNeedMore(context, ["UnitData", "Config.fcg"])).toEqual(focused);
  });

  it("sends queries and focus files and parses dig output", async () => {
    const digOutput = { findings: [], unknowns: [], answers: ["The reader is GetBaseATK"] };
    const { runner, calls } = scriptedRunner({ dig: digOutput });
    const result = await runDigPass({ runner, config: CONFIG }, context, ["UnitData"]);
    expect(result.output).toEqual(digOutput);
    expect(result.focused.anchors.length).toBeGreaterThan(0);
    const call = firstCall(calls);
    expect(call.attachments.map((attachment) => attachment.uploadName)).toEqual([
      "task.json",
      "queries.json",
      "focus.jsonl",
    ]);
    const manifest = JSON.parse(call.manifestJson) as { stage: string };
    expect(manifest.stage).toBe("dig");
  });
});

describe("mergeReadOutputs", () => {
  it("dedupes findings across passes and orders by severity", () => {
    const read = {
      findings: [
        {
          statement: "Config change",
          anchors: ["a"],
          severity: "minor" as const,
          confidence: "inferred" as const,
        },
        {
          statement: "atk spike",
          anchors: ["b"],
          severity: "major" as const,
          confidence: "exact" as const,
        },
      ],
      unknowns: ["u1"],
      negativeResults: ["n1"],
      needMore: [],
    };
    const dig = {
      findings: [
        {
          statement: "ATK SPIKE",
          anchors: ["b"],
          severity: "critical" as const,
          confidence: "exact" as const,
        },
        {
          statement: "new risk",
          anchors: ["c"],
          severity: "critical" as const,
          confidence: "inferred" as const,
        },
      ],
      unknowns: ["U1", "u2"],
      answers: ["answer"],
    };
    const merged = mergeReadOutputs(read, dig);
    expect(merged.findings.map((finding) => finding.statement)).toEqual([
      "new risk",
      "atk spike",
      "Config change",
    ]);
    expect(merged.findings[1]?.severity).toBe("major");
    expect(merged.unknowns).toEqual(["u1", "u2"]);
    expect(merged.answers).toEqual(["answer"]);
    expect(merged.negativeResults).toEqual(["n1"]);
  });
});

describe("runSynthesizePass", () => {
  it("sends findings.json and anchors.jsonl and parses the report", async () => {
    const report = {
      verdict: "pass_with_warnings",
      qualityScore: 80,
      executiveSummary: "s",
      topConcerns: [],
      findings: [],
      recommendedTests: [],
      unknowns: [],
    };
    const { runner, calls } = scriptedRunner({ synthesize: report });
    const structured = { findings: [], unknowns: [], negativeResults: [], answers: [] };
    const result = await runSynthesizePass({ runner, config: CONFIG }, { context, structured });
    expect(result.output).toEqual(report);
    expect(firstCall(calls).attachments.map((attachment) => attachment.uploadName)).toEqual([
      "task.json",
      "findings.json",
      "anchors.jsonl",
    ]);
  });
});

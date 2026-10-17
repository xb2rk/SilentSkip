import type { ReadOutput, SynthesizeOutput } from "@craftland-qa/contracts";
import { describe, expect, it } from "vitest";
import type { InseaRunRequest } from "../src/index";
import { runReviewPipeline } from "../src/index";
import {
  ANCHOR_A_ATK,
  ANCHOR_B_ATK,
  ANCHOR_B_MOD,
  makeDigest,
  SCRIPT_PATH,
} from "./helpers/digest-fixture";
import { attachmentOf, type ScriptValue, scriptedRunner } from "./helpers/scripted-runner";

const CONFIG = { workflowUrl: "https://example.test/run", apiKey: "k" };

const MAP_OUTPUT = {
  themes: [
    { name: "Script", files: ["f1"] },
    { name: "Data", files: ["f2"] },
  ],
};

function reading(anchors: string[], needMore: string[] = []): ReadOutput {
  const findings =
    anchors.length === 0
      ? []
      : [
          {
            title: "Change under review",
            statement: "The behavior changed",
            anchors,
            severity: "major" as const,
            confidence: "exact" as const,
            claims: [],
          },
        ];
  return { findings, unknowns: [], negativeResults: [], needMore };
}

function report(
  findings: SynthesizeOutput["findings"],
  themes: SynthesizeOutput["themes"],
): SynthesizeOutput {
  return {
    verdict: "needs_review",
    qualityScore: 80,
    executiveSummary: "Two files changed.",
    topConcerns: [],
    themes,
    findings,
    recommendedTests: [],
    unknowns: [],
  };
}

const GOOD_REPORT = report(
  [
    {
      title: "Script constant",
      statement: "The constant changed",
      anchors: [ANCHOR_B_MOD],
      severity: "major",
      confidence: "exact",
      claims: [],
    },
    {
      title: "Data row",
      statement: "The row changed",
      anchors: [ANCHOR_B_ATK],
      severity: "minor",
      confidence: "exact",
      claims: [],
    },
  ],
  [
    { themeId: "theme-1", narrative: "Data changed." },
    { themeId: "theme-2", narrative: "Script changed." },
  ],
);

function unitFilesOf(request: InseaRunRequest): string {
  const unit = attachmentOf(request, "unit.json");
  const parsed = JSON.parse(unit?.content ?? "{}") as { files?: string[] };
  return parsed.files?.[0] ?? "";
}

describe("runReviewPipeline v2", () => {
  it("runs map → one read per unit → synthesize", async () => {
    const scripted = scriptedRunner({
      map: MAP_OUTPUT as unknown as ScriptValue,
      read: (request) =>
        (unitFilesOf(request) === SCRIPT_PATH
          ? reading([ANCHOR_B_MOD])
          : reading([ANCHOR_B_ATK])) as unknown as Record<string, unknown>,
      synthesize: GOOD_REPORT as unknown as ScriptValue,
    });
    const result = await runReviewPipeline(
      { runner: scripted.runner, config: CONFIG },
      { digest: makeDigest() },
    );
    const stages = scripted.calls.map((call) => JSON.parse(call.manifestJson).stage as string);
    expect(stages).toEqual(["map", "read", "read", "synthesize"]);
    expect(result.passes.map((meta) => meta.pass)).toEqual(["map", "read", "read", "synthesize"]);
    expect(result.verification.read.findingsChecked).toBe(2);
    expect(result.verification.issues).toEqual([]);
    expect(result.structuredFindings.findings).toHaveLength(2);
    expect(result.report.verdict).toBe("needs_review");
    expect(result.report.themes).toHaveLength(2);
    expect(result.contextManifest.counts.evidence).toBe(4);
  });

  it("re-runs map with repair constraints when the partition is invalid", async () => {
    const scripted = scriptedRunner({
      map: ((_request: unknown, callIndex: number) =>
        (callIndex === 0
          ? { themes: [{ name: "Bad", files: ["f9"] }] }
          : MAP_OUTPUT) as unknown as Record<string, unknown>) as ScriptValue,
      read: (request: InseaRunRequest) =>
        (unitFilesOf(request) === SCRIPT_PATH
          ? reading([ANCHOR_B_MOD])
          : reading([ANCHOR_B_ATK])) as unknown as Record<string, unknown>,
      synthesize: GOOD_REPORT as unknown as ScriptValue,
    });
    const result = await runReviewPipeline(
      { runner: scripted.runner, config: CONFIG },
      { digest: makeDigest() },
    );
    const mapCalls = scripted.calls.filter(
      (call) => (JSON.parse(call.manifestJson) as { stage: string }).stage === "map",
    );
    expect(mapCalls).toHaveLength(2);
    expect(mapCalls[1]?.prompt).toContain("Constraints from the previous round");
    expect(mapCalls[1]?.prompt).toContain("unknown file id");
    expect(result.report.themes).toHaveLength(2);
    expect(result.verification.issues).toEqual([]);
    expect(result.report.verdict).toBe("needs_review");
  });

  it("falls back to the engine base partition when map never validates", async () => {
    const scripted = scriptedRunner({
      map: { themes: [{ name: "Bad", files: ["f9"] }] } as unknown as ScriptValue,
      read: (request: InseaRunRequest) =>
        (unitFilesOf(request) === SCRIPT_PATH
          ? reading([ANCHOR_B_MOD])
          : reading([ANCHOR_B_ATK])) as unknown as Record<string, unknown>,
      synthesize: GOOD_REPORT as unknown as ScriptValue,
    });
    const result = await runReviewPipeline(
      { runner: scripted.runner, config: CONFIG },
      { digest: makeDigest() },
    );
    const mapCalls = scripted.calls.filter(
      (call) => (JSON.parse(call.manifestJson) as { stage: string }).stage === "map",
    );
    expect(mapCalls).toHaveLength(2);
    expect(result.report.themes).toHaveLength(2);
    expect(result.verification.issues.some((issue) => issue.kind === "map-invalid")).toBe(true);
    expect(
      result.structuredFindings.unknowns.some((unknown) => unknown.includes("base partition")),
    ).toBe(true);
    expect(result.report.verdict).toBe("needs_review");
  });

  it("L1 re-reads units with engine findings left uninterpreted", async () => {
    const scripted = scriptedRunner({
      map: MAP_OUTPUT as unknown as ScriptValue,
      read: ((_request: unknown, callIndex: number) => {
        if (callIndex === 0) return reading([ANCHOR_B_MOD]) as unknown as Record<string, unknown>;
        if (callIndex === 1) return reading([]) as unknown as Record<string, unknown>;
        return reading([ANCHOR_A_ATK, ANCHOR_B_ATK]) as unknown as Record<string, unknown>;
      }) as ScriptValue,
      synthesize: GOOD_REPORT as unknown as ScriptValue,
    });
    const result = await runReviewPipeline(
      { runner: scripted.runner, config: CONFIG },
      { digest: makeDigest() },
    );
    const readCalls = scripted.calls.filter(
      (call) => (JSON.parse(call.manifestJson) as { stage: string }).stage === "read",
    );
    expect(readCalls).toHaveLength(3);
    expect(readCalls[2]?.prompt).toContain("Constraints from the previous round");
    expect(readCalls[2]?.prompt).toContain("STRUCT-01");
    expect(
      result.structuredFindings.unknowns.some((unknown) =>
        unknown.includes("Engine finding not interpreted"),
      ),
    ).toBe(false);
  });

  it("reports engine findings as unknowns when reading never cites them", async () => {
    const scripted = scriptedRunner({
      map: MAP_OUTPUT as unknown as ScriptValue,
      read: ((_request: unknown, callIndex: number) =>
        callIndex === 0
          ? (reading([ANCHOR_B_MOD]) as unknown as Record<string, unknown>)
          : (reading([]) as unknown as Record<string, unknown>)) as ScriptValue,
      synthesize: GOOD_REPORT as unknown as ScriptValue,
    });
    const result = await runReviewPipeline(
      { runner: scripted.runner, config: CONFIG },
      { digest: makeDigest() },
    );
    expect(
      result.structuredFindings.unknowns.some((unknown) =>
        unknown.includes("Engine finding not interpreted"),
      ),
    ).toBe(true);
  });

  it("L3 re-runs synthesize with linker constraints", async () => {
    const bad = report(
      [
        {
          title: "Script constant",
          statement: "The constant changed",
          anchors: [ANCHOR_B_MOD],
          severity: "major",
          confidence: "exact",
          claims: [],
        },
        {
          title: "Invented",
          statement: "Something new",
          anchors: [ANCHOR_A_ATK],
          severity: "minor",
          confidence: "exact",
          claims: [],
        },
      ],
      [
        { themeId: "theme-1", narrative: "Data changed." },
        { themeId: "theme-2", narrative: "Script changed." },
      ],
    );
    const scripted = scriptedRunner({
      map: MAP_OUTPUT as unknown as ScriptValue,
      read: ((request: unknown) =>
        (unitFilesOf(request as never) === SCRIPT_PATH
          ? reading([ANCHOR_B_MOD])
          : reading([ANCHOR_B_ATK])) as unknown as Record<string, unknown>) as ScriptValue,
      synthesize: ((_request: unknown, callIndex: number) =>
        (callIndex === 0 ? bad : GOOD_REPORT) as unknown as Record<string, unknown>) as ScriptValue,
    });
    const result = await runReviewPipeline(
      { runner: scripted.runner, config: CONFIG },
      { digest: makeDigest() },
    );
    const synthesizeCalls = scripted.calls.filter(
      (call) => (JSON.parse(call.manifestJson) as { stage: string }).stage === "synthesize",
    );
    expect(synthesizeCalls).toHaveLength(2);
    expect(synthesizeCalls[1]?.prompt).toContain("Constraints from the previous round");
    expect(result.verification.issues.some((issue) => issue.kind === "new-anchor")).toBe(true);
    expect(result.report.verdict).toBe("needs_review");
  });

  it("answers reading queries through one dig round", async () => {
    const scripted = scriptedRunner({
      map: MAP_OUTPUT as unknown as ScriptValue,
      read: ((request: unknown) =>
        (unitFilesOf(request as never) === SCRIPT_PATH
          ? reading([ANCHOR_B_MOD], ["scout"])
          : reading([ANCHOR_B_ATK])) as unknown as Record<string, unknown>) as ScriptValue,
      dig: {
        findings: [reading([ANCHOR_B_ATK]).findings[0]],
        unknowns: [],
        answers: ["Row changed"],
      } as unknown as ScriptValue,
      synthesize: GOOD_REPORT as unknown as ScriptValue,
    });
    const result = await runReviewPipeline(
      { runner: scripted.runner, config: CONFIG },
      { digest: makeDigest() },
    );
    const stages = scripted.calls.map((call) => JSON.parse(call.manifestJson).stage as string);
    expect(stages).toContain("dig");
    expect(result.structuredFindings.answers).toEqual(["Row changed"]);
  });

  it("skips map/read/dig when nothing changed", async () => {
    const digest = makeDigest();
    digest.changeFacts = [];
    digest.quantities = [];
    digest.findings = [];
    digest.plan = {
      units: [],
      skeleton: { files: [], importEdges: [] },
      partition: { clusters: [] },
    };
    const scripted = scriptedRunner({
      synthesize: report([], []) as unknown as ScriptValue,
    });
    const result = await runReviewPipeline({ runner: scripted.runner, config: CONFIG }, { digest });
    const stages = scripted.calls.map((call) => JSON.parse(call.manifestJson).stage as string);
    expect(stages).toEqual(["synthesize"]);
    expect(result.report.themes).toEqual([]);
    expect(result.passes.map((meta) => meta.pass)).toEqual(["synthesize"]);
  });

  it("emits stage events with unit and round", async () => {
    const events: string[] = [];
    const scripted = scriptedRunner({
      map: MAP_OUTPUT as unknown as ScriptValue,
      read: ((request: unknown) =>
        (unitFilesOf(request as never) === SCRIPT_PATH
          ? reading([ANCHOR_B_MOD])
          : reading([ANCHOR_B_ATK])) as unknown as Record<string, unknown>) as ScriptValue,
      synthesize: GOOD_REPORT as unknown as ScriptValue,
    });
    await runReviewPipeline(
      { runner: scripted.runner, config: CONFIG },
      {
        digest: makeDigest(),
        onEvent: (event) => {
          events.push(
            `${event.stage}:${event.state}${event.unit === undefined ? "" : `:${event.unit}`}${event.round === undefined ? "" : `:r${event.round}`}`,
          );
        },
      },
    );
    expect(events).toContain("map:started");
    expect(events).toContain("read:started:1:r1");
    expect(events).toContain("read:completed:2:r1");
    expect(events).toContain("synthesize:completed:r1");
  });

  it("re-runs map when its output fails schema validation", async () => {
    const scripted = scriptedRunner({
      map: ((_request: unknown, callIndex: number) =>
        (callIndex === 0
          ? { themes: [{ name: "Broken", files: [] }] }
          : MAP_OUTPUT) as unknown as Record<string, unknown>) as ScriptValue,
      read: (request) =>
        (unitFilesOf(request) === SCRIPT_PATH
          ? reading([ANCHOR_B_MOD])
          : reading([ANCHOR_B_ATK])) as unknown as Record<string, unknown>,
      synthesize: GOOD_REPORT as unknown as ScriptValue,
    });
    const result = await runReviewPipeline(
      { runner: scripted.runner, config: CONFIG },
      { digest: makeDigest() },
    );
    const mapCalls = scripted.calls.filter(
      (call) => (JSON.parse(call.manifestJson) as { stage: string }).stage === "map",
    );
    expect(mapCalls).toHaveLength(2);
    expect(mapCalls[1]?.prompt).toContain("failed schema validation");
    expect(result.report.themes).toHaveLength(2);
    expect(result.report.verdict).toBe("needs_review");
  });

  it("survives a malformed read output and re-reads the unit", async () => {
    const scripted = scriptedRunner({
      map: MAP_OUTPUT as unknown as ScriptValue,
      read: ((_request: unknown, callIndex: number) => {
        if (callIndex === 0) return { findings: [{ title: "Broken" }] } as Record<string, unknown>;
        if (callIndex === 1)
          return reading([ANCHOR_A_ATK, ANCHOR_B_ATK]) as unknown as Record<string, unknown>;
        return reading([ANCHOR_B_MOD]) as unknown as Record<string, unknown>;
      }) as ScriptValue,
      synthesize: GOOD_REPORT as unknown as ScriptValue,
    });
    const result = await runReviewPipeline(
      { runner: scripted.runner, config: CONFIG },
      { digest: makeDigest() },
    );
    expect(result.verification.issues.some((issue) => issue.kind === "read-invalid")).toBe(true);
    expect(
      result.structuredFindings.unknowns.some((unknown) =>
        unknown.includes("Engine finding not interpreted"),
      ),
    ).toBe(false);
    expect(result.report.verdict).toBe("needs_review");
  });
});

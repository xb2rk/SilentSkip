import type { ReadOutput, SynthesizeOutput } from "@silentskip/contracts";
import { describe, expect, it } from "vitest";
import type {
  CachedPassCall,
  InseaRunRequest,
  InseaRunResult,
  LinkIssueKind,
  PassCache,
  PipelineCheckpoint,
  WorkflowRunner,
} from "../src/index";
import {
  AiError,
  BLOCKING_SYNTHESIZE_ISSUE_KINDS,
  runReviewPipeline,
  withPassCache,
} from "../src/index";
import {
  ANCHOR_A_ATK,
  ANCHOR_B_ATK,
  ANCHOR_B_MOD,
  makeDigest,
  SCRIPT_PATH,
  TABLE_PATH,
} from "./helpers/digest-fixture";
import { attachmentOf, type ScriptValue, scriptedRunner, stageOf } from "./helpers/scripted-runner";

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
    {
      themeId: "theme-1",
      summary: "Data changed.",
      behaviorChange: "The row value changed.",
      watchFor: "Combat numbers.",
      anchorIds: [ANCHOR_B_ATK],
    },
    {
      themeId: "theme-2",
      summary: "Script changed.",
      behaviorChange: "The constant changed.",
      watchFor: "Skill behavior.",
      anchorIds: [ANCHOR_B_MOD],
    },
  ],
);

function unitFilesOf(request: InseaRunRequest): string {
  const unit = attachmentOf(request, "unit.json");
  const parsed = JSON.parse(unit?.content ?? "{}") as { files?: string[] };
  return parsed.files?.[0] ?? "";
}

/**
 * Scripted runner that scripts every stage normally but makes the calls of `stage` from
 * `failFromCall` on fail with the given `AiError` — a transport failure, which `scriptedRunner`
 * cannot express. `failFromCall = 0` therefore kills the whole stage.
 */
function failingStage(
  stage: "map" | "read" | "dig" | "synthesize",
  error: AiError,
  failFromCall = 0,
): WorkflowRunner {
  const scripted = scriptedRunner({
    map: MAP_OUTPUT as unknown as ScriptValue,
    read: (request) =>
      (unitFilesOf(request) === SCRIPT_PATH
        ? reading([ANCHOR_B_MOD])
        : reading([ANCHOR_B_ATK])) as unknown as Record<string, unknown>,
    synthesize: GOOD_REPORT as unknown as ScriptValue,
  });
  let seen = 0;
  return async (request) => {
    if (stageOf(request) !== stage) return await scripted.runner(request);
    const index = seen;
    seen += 1;
    if (index >= failFromCall) throw error;
    return await scripted.runner(request);
  };
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
    expect(result.themes.map((theme) => theme.id)).toEqual(["theme-1", "theme-2"]);
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
          anchors: ["B:ghost:1:1:code"],
          severity: "minor",
          confidence: "exact",
          claims: [],
        },
      ],
      [
        {
          themeId: "theme-1",
          summary: "Data changed.",
          behaviorChange: "The row value changed.",
          watchFor: "Combat numbers.",
          anchorIds: [ANCHOR_B_ATK],
        },
        {
          themeId: "theme-2",
          summary: "Script changed.",
          behaviorChange: "The constant changed.",
          watchFor: "Skill behavior.",
          anchorIds: [ANCHOR_B_MOD],
        },
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
    expect(result.verification.issues.some((issue) => issue.kind === "finding-unanchored")).toBe(
      true,
    );
    expect(result.report.verdict).toBe("needs_review");
  });

  it("keeps a stray anchor without a second synthesize round", async () => {
    const stray = report(
      [
        {
          title: "Script constant",
          statement: "The constant changed",
          anchors: [ANCHOR_B_MOD, ANCHOR_A_ATK],
          severity: "major",
          confidence: "exact",
          claims: [],
        },
      ],
      GOOD_REPORT.themes,
    );
    const scripted = scriptedRunner({
      map: MAP_OUTPUT as unknown as ScriptValue,
      read: ((request: unknown) =>
        (unitFilesOf(request as never) === SCRIPT_PATH
          ? reading([ANCHOR_B_MOD])
          : reading([ANCHOR_B_ATK])) as unknown as Record<string, unknown>) as ScriptValue,
      synthesize: stray as unknown as ScriptValue,
    });
    const result = await runReviewPipeline(
      { runner: scripted.runner, config: CONFIG },
      { digest: makeDigest() },
    );
    const synthesizeCalls = scripted.calls.filter(
      (call) => (JSON.parse(call.manifestJson) as { stage: string }).stage === "synthesize",
    );
    expect(synthesizeCalls).toHaveLength(1);
    expect(result.verification.issues.some((issue) => issue.kind === "new-anchor")).toBe(true);
    expect(result.report.findings).toHaveLength(1);
  });

  it("salvages findings with failing claims via Fast Repair Gate on final synthesize round", async () => {
    const findingWithBadClaim = {
      title: "Script constant",
      statement: "The constant changed",
      anchors: [ANCHOR_B_MOD],
      severity: "major" as const,
      confidence: "exact" as const,
      claims: [
        {
          subject: "q:value|A|Assets/Scripts/Config.fcg|_MOD",
          relation: "equals" as const,
          object: "q:value|B|Assets/Scripts/Config.fcg|_MOD",
        },
      ],
    };
    const reportWithBadClaim = report([findingWithBadClaim], GOOD_REPORT.themes);
    const scripted = scriptedRunner({
      map: MAP_OUTPUT as unknown as ScriptValue,
      read: ((request: unknown) =>
        (unitFilesOf(request as never) === SCRIPT_PATH
          ? reading([ANCHOR_B_MOD])
          : reading([ANCHOR_B_ATK])) as unknown as Record<string, unknown>) as ScriptValue,
      synthesize: reportWithBadClaim as unknown as ScriptValue,
    });
    const result = await runReviewPipeline(
      { runner: scripted.runner, config: CONFIG },
      { digest: makeDigest() },
    );
    expect(result.report.verdict).toBe("needs_review");
    expect(result.report.findings).toHaveLength(1);
    expect(result.report.findings[0]?.confidence).toBe("inferred");
    expect(result.report.findings[0]?.claims).toHaveLength(0);
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

  it("records unresolved reading queries without paying for a dig call", async () => {
    const scripted = scriptedRunner({
      map: MAP_OUTPUT as unknown as ScriptValue,
      read: ((request: unknown) =>
        (unitFilesOf(request as never) === SCRIPT_PATH
          ? reading([ANCHOR_B_MOD], ["zzznope nothing-here xyzzy"])
          : reading([ANCHOR_B_ATK])) as unknown as Record<string, unknown>) as ScriptValue,
      synthesize: GOOD_REPORT as unknown as ScriptValue,
    });
    const result = await runReviewPipeline(
      { runner: scripted.runner, config: CONFIG },
      { digest: makeDigest() },
    );
    const stages = scripted.calls.map((call) => JSON.parse(call.manifestJson).stage as string);
    expect(stages).not.toContain("dig");
    expect(
      result.structuredFindings.unknowns.some((item) => item.includes("no matching evidence span")),
    ).toBe(true);
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

  it("retries synthesize after a schema-invalid round instead of dying", async () => {
    const scripted = scriptedRunner({
      map: MAP_OUTPUT as unknown as ScriptValue,
      read: (request) =>
        (unitFilesOf(request) === SCRIPT_PATH
          ? reading([ANCHOR_B_MOD])
          : reading([ANCHOR_B_ATK])) as unknown as Record<string, unknown>,
      synthesize: ((_request: unknown, callIndex: number) =>
        (callIndex === 0 ? { verdict: "totally-fine" } : GOOD_REPORT) as unknown as Record<
          string,
          unknown
        >) as ScriptValue,
    });
    const result = await runReviewPipeline(
      { runner: scripted.runner, config: CONFIG },
      { digest: makeDigest() },
    );
    const synthesizeCalls = scripted.calls.filter(
      (call) => (JSON.parse(call.manifestJson) as { stage: string }).stage === "synthesize",
    );
    expect(synthesizeCalls).toHaveLength(2);
    expect(result.verification.issues.some((issue) => issue.kind === "synthesize-invalid")).toBe(
      true,
    );
    expect(result.report.verdict).toBe("needs_review");
  });

  it("degrades instead of dying when map times out", async () => {
    const result = await runReviewPipeline(
      { runner: failingStage("map", new AiError("timeout", "timed out")), config: CONFIG },
      { digest: makeDigest() },
    );
    expect(result.degradedReason).toContain("timeout");
    // The engine base partition stands in, so the change map survives a dead map pass.
    expect(result.themes.map((theme) => theme.name)).toEqual(["cluster-1", "cluster-2"]);
    expect(result.verification.issues.some((issue) => issue.kind === "map-timeout")).toBe(true);
    // Reading and synthesis still ran, so the report is a real one — only the theme naming is lost.
    expect(result.report.findings.length).toBeGreaterThan(0);
    expect(result.report.verdict).toBe("needs_review");
  });

  it("degrades on a dead read transport and still reports the unit that answered", async () => {
    const result = await runReviewPipeline(
      {
        runner: failingStage("read", new AiError("network", "socket hang up"), 1),
        config: CONFIG,
      },
      { digest: makeDigest() },
    );
    expect(result.verification.issues.some((issue) => issue.kind === "read-unavailable")).toBe(
      true,
    );
    expect(result.degradedReason).toContain("network");
    expect(result.report.findings.length).toBeGreaterThan(0);
  });

  it("keeps the readings as a partial report when synthesize times out", async () => {
    const result = await runReviewPipeline(
      { runner: failingStage("synthesize", new AiError("timeout", "timed out")), config: CONFIG },
      { digest: makeDigest() },
    );
    expect(result.structuredFindings.findings.length).toBeGreaterThan(0);
    // Nothing is invented: the report carries the verified readings verbatim.
    expect(result.report.findings).toEqual(
      result.structuredFindings.findings.map((finding) => ({ ...finding })),
    );
    expect(result.report.verdict).toBe("insufficient_evidence");
    expect(result.report.qualityScore).toBe(0);
    expect(result.report.themes).toEqual([]);
    expect(result.degradedReason).toContain("timeout");
    expect(result.passes.map((meta) => meta.pass)).toEqual(["map", "read", "read"]);
  });

  it("clears the degraded label when a failed read recovers on the L1 re-read", async () => {
    const scripted = scriptedRunner({
      map: MAP_OUTPUT as unknown as ScriptValue,
      read: (request) =>
        (unitFilesOf(request) === SCRIPT_PATH
          ? reading([ANCHOR_B_MOD])
          : reading([ANCHOR_B_ATK])) as unknown as Record<string, unknown>,
      synthesize: GOOD_REPORT as unknown as ScriptValue,
    });
    let readCalls = 0;
    const flakyRead: WorkflowRunner = async (request) => {
      if (stageOf(request) !== "read") return await scripted.runner(request);
      const index = readCalls;
      readCalls += 1;
      if (index === 1) throw new AiError("network", "socket hang up");
      return await scripted.runner(request);
    };
    const result = await runReviewPipeline(
      { runner: flakyRead, config: CONFIG },
      { digest: makeDigest() },
    );
    expect(result.verification.issues.some((issue) => issue.kind === "read-unavailable")).toBe(
      true,
    );
    expect(result.degradedReason).toBeNull();
    expect(result.report.verdict).toBe("needs_review");
  });

  it("clears the degraded label when synthesize recovers on the second round", async () => {
    const scripted = scriptedRunner({
      map: MAP_OUTPUT as unknown as ScriptValue,
      read: (request) =>
        (unitFilesOf(request) === SCRIPT_PATH
          ? reading([ANCHOR_B_MOD])
          : reading([ANCHOR_B_ATK])) as unknown as Record<string, unknown>,
      synthesize: GOOD_REPORT as unknown as ScriptValue,
    });
    let synthCalls = 0;
    const flakySynthesize: WorkflowRunner = async (request) => {
      if (stageOf(request) !== "synthesize") return await scripted.runner(request);
      const index = synthCalls;
      synthCalls += 1;
      if (index === 0) throw new AiError("timeout", "timed out");
      return await scripted.runner(request);
    };
    const result = await runReviewPipeline(
      { runner: flakySynthesize, config: CONFIG },
      { digest: makeDigest() },
    );
    expect(result.verification.issues.some((issue) => issue.kind === "synthesize-timeout")).toBe(
      true,
    );
    expect(synthCalls).toBe(2);
    expect(result.degradedReason).toBeNull();
    expect(result.report.verdict).toBe("needs_review");
  });

  it("never degrades a cancelled run", async () => {
    await expect(
      runReviewPipeline(
        { runner: failingStage("read", new AiError("cancelled", "cancelled")), config: CONFIG },
        { digest: makeDigest() },
      ),
    ).rejects.toMatchObject({ code: "cancelled" });
  });

  it("checkpoints after map, at the end of each reading round, and before synthesis", async () => {
    const scripted = scriptedRunner({
      map: MAP_OUTPUT as unknown as ScriptValue,
      read: (request) =>
        (unitFilesOf(request) === SCRIPT_PATH
          ? reading([ANCHOR_B_MOD])
          : reading([ANCHOR_B_ATK])) as unknown as Record<string, unknown>,
      synthesize: GOOD_REPORT as unknown as ScriptValue,
    });
    const checkpoints: PipelineCheckpoint[] = [];
    await runReviewPipeline(
      { runner: scripted.runner, config: CONFIG },
      {
        digest: makeDigest(),
        onCheckpoint: (snapshot) => {
          checkpoints.push(snapshot);
        },
      },
    );
    // One checkpoint after map, one at the end of the reading round, one before synthesis.
    expect(checkpoints.length).toBe(3);
    expect(checkpoints[0]?.passes.map((meta) => meta.pass)).toEqual(["map"]);
    expect(checkpoints.at(-1)?.passes.map((meta) => meta.pass)).toEqual(["map", "read", "read"]);
  });

  it("only rewrites the report for issues that make it substantively wrong", () => {
    expect([...BLOCKING_SYNTHESIZE_ISSUE_KINDS].sort()).toEqual([
      "claim-false",
      "claim-invalid",
      "finding-unanchored",
      "theme-invalid",
    ]);
    const cosmetic: LinkIssueKind[] = [
      "unknown-anchor",
      "unknown-fact",
      "free-number",
      "quote-unverified",
      "verdict-downgraded",
    ];
    for (const kind of cosmetic) {
      expect(BLOCKING_SYNTHESIZE_ISSUE_KINDS.has(kind)).toBe(false);
    }
  });

  it("does not re-read a unit that answered with nothing to report", async () => {
    const scripted = scriptedRunner({
      map: MAP_OUTPUT as unknown as ScriptValue,
      read: ((_request: InseaRunRequest, callIndex: number) =>
        callIndex === 0
          ? reading([])
          : reading([ANCHOR_A_ATK, ANCHOR_B_ATK])) as unknown as ScriptValue,
      synthesize: GOOD_REPORT as unknown as ScriptValue,
    });
    const result = await runReviewPipeline(
      { runner: scripted.runner, config: CONFIG },
      { digest: makeDigest() },
    );
    const readCalls = scripted.calls.filter((call) => stageOf(call) === "read");
    // Unit 1 stayed quiet, but it owns no uninterpreted engine finding, so L1 has nothing to chase:
    // the second unit's anchors already cover the engine finding.
    expect(readCalls).toHaveLength(2);
    expect(result.verification.issues.some((issue) => issue.pass === "read")).toBe(false);
    expect(
      result.structuredFindings.unknowns.some((unknown) =>
        unknown.includes("Engine finding not interpreted"),
      ),
    ).toBe(false);
  });

  it("re-reads a unit whose reading never arrived, even with nothing left to interpret", async () => {
    const scripted = scriptedRunner({
      map: MAP_OUTPUT as unknown as ScriptValue,
      read: ((_request: InseaRunRequest, callIndex: number) =>
        callIndex === 0
          ? { findings: [{ title: "Broken" }] }
          : callIndex === 1
            ? reading([ANCHOR_A_ATK, ANCHOR_B_ATK])
            : reading([ANCHOR_B_MOD])) as unknown as ScriptValue,
      synthesize: GOOD_REPORT as unknown as ScriptValue,
    });
    const result = await runReviewPipeline(
      { runner: scripted.runner, config: CONFIG },
      { digest: makeDigest() },
    );
    const readCalls = scripted.calls.filter((call) => stageOf(call) === "read");
    // The first unit's output failed to parse, so it is read again in L1 — a unit with no reading at
    // all is worse than an expensive one.
    expect(readCalls).toHaveLength(3);
    expect(unitFilesOf(readCalls[2] as InseaRunRequest)).toBe(SCRIPT_PATH);
    expect(result.verification.issues.some((issue) => issue.kind === "read-invalid")).toBe(true);
  });

  it("answers a repeated run of the same comparison from the cache", async () => {
    const store = new Map<string, CachedPassCall>();
    const cache: PassCache = {
      get: (key) => Promise.resolve(store.get(key)),
      set: (key, call) => {
        store.set(key, call);
        return Promise.resolve();
      },
    };
    const scripted = scriptedRunner({
      map: MAP_OUTPUT as unknown as ScriptValue,
      read: (request) =>
        (unitFilesOf(request) === SCRIPT_PATH
          ? reading([ANCHOR_B_MOD])
          : reading([ANCHOR_B_ATK])) as unknown as Record<string, unknown>,
      synthesize: GOOD_REPORT as unknown as ScriptValue,
    });
    const runner = withPassCache(scripted.runner, cache);

    const first = await runReviewPipeline({ runner, config: CONFIG }, { digest: makeDigest() });
    const liveCalls = scripted.calls.length;
    expect(liveCalls).toBeGreaterThanOrEqual(4);
    expect(first.passes.some((meta) => meta.cached === true)).toBe(false);

    const second = await runReviewPipeline({ runner, config: CONFIG }, { digest: makeDigest() });
    // Same comparison, same inputs: every pass is replayed, nothing reaches the workflow again,
    // and the run claims no AI time it did not spend.
    expect(scripted.calls.length).toBe(liveCalls);
    expect(second.passes.every((meta) => meta.cached === true)).toBe(true);
    expect(second.passes.reduce((sum, meta) => sum + meta.latencyMs, 0)).toBe(0);
    expect(second.report).toEqual(first.report);
    expect(second.structuredFindings).toEqual(first.structuredFindings);
    expect(second.themes).toEqual(first.themes);
  });

  it("reads every unit the same way whatever the pool size is", async () => {
    const script = () =>
      scriptedRunner({
        map: MAP_OUTPUT as unknown as ScriptValue,
        read: (request) =>
          (unitFilesOf(request) === SCRIPT_PATH
            ? reading([ANCHOR_B_MOD])
            : reading([ANCHOR_B_ATK])) as unknown as Record<string, unknown>,
        synthesize: GOOD_REPORT as unknown as ScriptValue,
      });
    const sequential = await runReviewPipeline(
      { runner: script().runner, config: CONFIG },
      { digest: makeDigest() },
    );
    const wide = await runReviewPipeline(
      { runner: script().runner, config: { ...CONFIG, readConcurrency: 3 } },
      { digest: makeDigest() },
    );
    // Latency is the only thing concurrency is allowed to move: the report, the merged readings,
    // the linker verdicts and the pass order must all be identical.
    const shape = (result: Awaited<ReturnType<typeof runReviewPipeline>>) => ({
      report: result.report,
      structured: result.structuredFindings,
      themes: result.themes,
      issues: result.verification.issues,
      readStats: result.verification.read,
      passes: result.passes.map((meta) => ({
        pass: meta.pass,
        unit: meta.unit,
        chunk: meta.chunk,
        chunks: meta.chunks,
        round: meta.round,
      })),
    });
    expect(shape(wide)).toEqual(shape(sequential));
    expect(wide.passes.filter((meta) => meta.pass === "read").map((meta) => meta.unit)).toEqual([
      1, 2,
    ]);
  });

  it("never keeps more read calls in flight than the configured pool", async () => {
    // Four units over the same file: enough independent calls for a pool to be observable.
    const fourUnitDigest = () => {
      const digest = makeDigest();
      const [first] = digest.plan.units;
      if (first === undefined) throw new Error("fixture has no reading unit");
      digest.plan.units = [0, 1, 2, 3].map((index) => ({ ...first, index }));
      return digest;
    };

    const probe = async (readConcurrency: number): Promise<number> => {
      const scripted = scriptedRunner({
        map: MAP_OUTPUT as unknown as ScriptValue,
        read: reading([ANCHOR_B_ATK]) as unknown as ScriptValue,
        synthesize: GOOD_REPORT as unknown as ScriptValue,
      });
      let inFlight = 0;
      let peak = 0;
      const runner: WorkflowRunner = async (request) => {
        if (stageOf(request) !== "read") return scripted.runner(request);
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        try {
          // Hold the call open so overlapping calls are actually observable.
          await new Promise((resolve) => setTimeout(resolve, 5));
          return await scripted.runner(request);
        } finally {
          inFlight -= 1;
        }
      };
      await runReviewPipeline(
        { runner, config: { ...CONFIG, readConcurrency } },
        { digest: fourUnitDigest() },
      );
      return peak;
    };

    expect(await probe(1)).toBe(1);
    expect(await probe(3)).toBe(3);
    // The pool is a limit, not a target: more slots than units never invents a call.
    expect(await probe(16)).toBe(4);
  });

  it("keeps the readings that landed when a round is cancelled", async () => {
    const scripted = scriptedRunner({
      map: MAP_OUTPUT as unknown as ScriptValue,
      synthesize: GOOD_REPORT as unknown as ScriptValue,
    });
    const controller = new AbortController();
    let readCalls = 0;
    const runner: WorkflowRunner = async (request) => {
      if (stageOf(request) !== "read") return scripted.runner(request);
      readCalls += 1;
      if (readCalls === 1) {
        return {
          output: reading([ANCHOR_B_MOD]) as unknown as Record<string, unknown>,
          rawResult: "{}",
          salvage: "clean",
          latencyMs: 4,
        };
      }
      // The second unit never answers: it dies with the run's signal.
      const signal = request.signal;
      return await new Promise<InseaRunResult>((_resolve, reject) => {
        const fail = (): void => reject(new AiError("cancelled", "run cancelled"));
        if (signal?.aborted === true) {
          fail();
          return;
        }
        signal?.addEventListener("abort", fail, { once: true });
      });
    };
    const checkpoints: PipelineCheckpoint[] = [];
    const run = runReviewPipeline(
      { runner, config: { ...CONFIG, readConcurrency: 3 } },
      {
        digest: makeDigest(),
        signal: controller.signal,
        onCheckpoint: (snapshot) => {
          checkpoints.push(snapshot);
        },
      },
    );
    setTimeout(() => controller.abort(), 20);
    await expect(run).rejects.toMatchObject({ code: "cancelled" });
    // The cancelled round still reports the call that answered: cancelling is not a wipe.
    expect(checkpoints.at(-1)?.passes.map((meta) => meta.pass)).toEqual(["map", "read"]);
  });

  it("re-reads a unit when only one of its chunks failed", async () => {
    // One unit, two files, material big enough to split into two read calls at any sane budget. The
    // chunk holding the big file dies (degradable), the other answers — so the unit is half read and
    // the coverage loop has to queue it again. A partially read unit is not a covered unit.
    const digest = makeDigest();
    const [unit] = digest.plan.units;
    if (unit === undefined) throw new Error("fixture has no reading unit");
    unit.files = [SCRIPT_PATH, TABLE_PATH];
    unit.payload = JSON.stringify([
      { path: SCRIPT_PATH, status: "changed", filler: "x".repeat(300_000) },
      { path: TABLE_PATH, status: "changed" },
    ]);

    const scripted = scriptedRunner({
      map: MAP_OUTPUT as unknown as ScriptValue,
      synthesize: GOOD_REPORT as unknown as ScriptValue,
    });
    let readCalls = 0;
    const runner: WorkflowRunner = async (request) => {
      if (stageOf(request) !== "read") return scripted.runner(request);
      readCalls += 1;
      const unitFile = attachmentOf(request, "unit.json");
      const files =
        (JSON.parse(unitFile?.content ?? "{}") as { files?: readonly string[] }).files ?? [];
      if (files.includes(SCRIPT_PATH)) throw new AiError("timeout", "timed out");
      return {
        output: reading([ANCHOR_B_ATK]) as unknown as Record<string, unknown>,
        rawResult: "{}",
        salvage: "clean",
        latencyMs: 5,
      };
    };

    const result = await runReviewPipeline({ runner, config: CONFIG }, { digest });
    // Round 1 read both chunks of the unit (one failed) plus the second unit; round 2 retried the
    // unit that was left half read. Nothing re-reads the unit that answered in full.
    expect(
      result.passes
        .filter((meta) => meta.pass === "read")
        .map((meta) => [meta.unit, meta.round, meta.chunk]),
    ).toEqual([
      [1, 1, 2],
      [2, 1, 1],
      [1, 2, 2],
    ]);
    expect(readCalls).toBe(5);
    expect(result.degradedReason).toContain("timeout");
  });
});

import type { MapOutput, ReadOutput } from "@silentskip/contracts";
import { describe, expect, it } from "vitest";
import {
  AiError,
  buildReviewContext,
  mergeStructured,
  normalizeThemes,
  payloadAccounting,
  resolveNeedMore,
  runDigPass,
  runMapPass,
  runReadPass,
  runSynthesizePass,
} from "../src/index";
import { ANCHOR_B_ATK, makeDigest, SCRIPT_PATH, TABLE_PATH } from "./helpers/digest-fixture";
import {
  attachmentOf,
  firstCall,
  type ScriptValue,
  scriptedRunner,
} from "./helpers/scripted-runner";

const CONFIG = { workflowUrl: "https://example.test/run", apiKey: "k" };
const CONTEXT = buildReviewContext(makeDigest(), { goal: "Check pacing" });

function depsFor(script: Record<string, ScriptValue>): {
  deps: { runner: ReturnType<typeof scriptedRunner>["runner"]; config: typeof CONFIG };
  calls: ReturnType<typeof scriptedRunner>["calls"];
} {
  const scripted = scriptedRunner(script);
  return { deps: { runner: scripted.runner, config: CONFIG }, calls: scripted.calls };
}

function reading(anchors: string[]): ReadOutput {
  return {
    findings: [
      {
        title: "Change under review",
        statement: "The behavior changed",
        anchors,
        severity: "major",
        confidence: "exact",
        claims: [],
      },
    ],
    unknowns: [],
    negativeResults: [],
    needMore: [],
  };
}

describe("map pass", () => {
  it("parses the map output and sends task + skeleton", async () => {
    const output: MapOutput = {
      themes: [
        { name: "Sv", files: [SCRIPT_PATH] },
        { name: "Tv", files: [TABLE_PATH] },
      ],
    };
    const { deps, calls } = depsFor({ map: output as unknown as ScriptValue });
    const result = await runMapPass(deps, CONTEXT, []);
    expect(result.output).toEqual(output);
    expect(result.meta).toMatchObject({
      pass: "map",
      promptVersion: "2.1.1",
      latencyMs: 7,
      salvage: "clean",
      cached: false,
    });
    expect(result.meta.finishedAt).toBeGreaterThanOrEqual(result.meta.startedAt);
    expect(calls.map((call) => call.prompt.length > 0)).toEqual([true]);
    expect(firstCall(calls).attachments.map((item) => item.uploadName)).toEqual([
      "task.json",
      "skeleton.json",
    ]);
    const manifest = JSON.parse(firstCall(calls).manifestJson) as { stage: string };
    expect(manifest.stage).toBe("map");
  });

  it("rejects drifted map output with a typed error", async () => {
    const { deps } = depsFor({ map: { themes: "nope" } });
    await expect(runMapPass(deps, CONTEXT, [])).rejects.toThrowError(
      /map output failed schema validation/,
    );
  });
});

describe("normalizeThemes", () => {
  const ID_MAP = new Map([
    ["f1", SCRIPT_PATH],
    ["f2", TABLE_PATH],
  ]);

  it("resolves file ids, orders themes by first file and assigns stable engine ids", () => {
    const normalized = normalizeThemes(
      {
        themes: [
          { name: "Scripts", files: ["f1"] },
          { name: "Data", files: ["f2"] },
        ],
      },
      ID_MAP,
    );
    expect("themes" in normalized && normalized.themes).toEqual([
      { id: "theme-1", name: "Data", files: [TABLE_PATH] },
      { id: "theme-2", name: "Scripts", files: [SCRIPT_PATH] },
    ]);
  });

  it("rejects blank theme names instead of producing an unreadable report", () => {
    expect(normalizeThemes({ themes: [{ name: "   ", files: ["f1", "f2"] }] }, ID_MAP)).toEqual({
      error: 'theme "   " has a blank name; give every theme a short label',
    });
  });

  it("rejects unknown ids, duplicates and missing coverage", () => {
    expect(normalizeThemes({ themes: [{ name: "x", files: ["f9"] }] }, ID_MAP)).toEqual({
      error: 'theme "x" references an unknown file id: f9 (ids are like f1…f2)',
    });
    expect(
      normalizeThemes(
        {
          themes: [
            { name: "a", files: ["f1"] },
            { name: "b", files: ["f1"] },
          ],
        },
        ID_MAP,
      ),
    ).toEqual({ error: `file appears in more than one theme: ${SCRIPT_PATH}` });
    expect(normalizeThemes({ themes: [{ name: "a", files: ["f1"] }] }, ID_MAP)).toEqual({
      error: `file not covered by any theme: ${TABLE_PATH} (id f2)`,
    });
  });
});

describe("read pass", () => {
  it("sends the unit, its facts slice, snippet anchors and the skeleton", async () => {
    const { deps, calls } = depsFor({ read: reading([ANCHOR_B_ATK]) as unknown as ScriptValue });
    const unit = CONTEXT.plan.units[0];
    if (unit === undefined) throw new Error("fixture must have a unit");
    const result = await runReadPass(deps, CONTEXT, unit, {
      round: 1,
      constraints: [],
      relatedFindings: CONTEXT.engineFindings,
      anchors: CONTEXT.evidence,
      chunk: 1,
      chunks: 1,
    });
    expect(result.output.findings).toHaveLength(1);
    expect(result.meta).toMatchObject({
      pass: "read",
      promptVersion: "2.2.1",
      latencyMs: 7,
      salvage: "clean",
      unit: 1,
      chunk: 1,
      chunks: 1,
      round: 1,
      cached: false,
    });
    expect(firstCall(calls).attachments.map((item) => item.uploadName)).toEqual([
      "task.json",
      "unit.json",
      "facts.json",
      "bodies.jsonl",
      "anchors.jsonl",
      "skeleton.json",
    ]);
    const facts = JSON.parse(attachmentOf(firstCall(calls), "facts.json")?.content ?? "{}") as {
      quantities: unknown[];
    };
    expect(facts.quantities).toHaveLength(5);
    expect(
      (attachmentOf(firstCall(calls), "anchors.jsonl")?.content ?? "").split("\n"),
    ).toHaveLength(4);
    expect(
      (attachmentOf(firstCall(calls), "bodies.jsonl")?.content ?? "").split("\n"),
    ).toHaveLength(1);
  });

  it("carries round constraints into the prompt", async () => {
    const { deps, calls } = depsFor({ read: reading([ANCHOR_B_ATK]) as unknown as ScriptValue });
    const unit = CONTEXT.plan.units[0];
    if (unit === undefined) throw new Error("fixture must have a unit");
    await runReadPass(deps, CONTEXT, unit, {
      round: 2,
      constraints: ["STRUCT-01: Row width differs — anchors: x"],
      relatedFindings: [],
      anchors: [],
      chunk: 1,
      chunks: 1,
    });
    expect(firstCall(calls).prompt).toContain("Constraints from the previous round");
    expect(firstCall(calls).prompt).toContain("STRUCT-01");
  });
});

describe("dig pass", () => {
  it("sends queries and focus, parses answers", async () => {
    const { deps, calls } = depsFor({
      dig: { findings: [], unknowns: [], answers: ["The row changed"] },
    });
    const result = await runDigPass(deps, CONTEXT, ["scout"], undefined, undefined);
    expect(result.output.answers).toEqual(["The row changed"]);
    expect(result.meta.pass).toBe("dig");
    expect(firstCall(calls).attachments.map((item) => item.uploadName)).toEqual([
      "task.json",
      "queries.json",
      "focus.jsonl",
    ]);
  });
});

describe("resolveNeedMore", () => {
  it("resolves natural-language queries by tokens instead of the whole string", () => {
    const focused = resolveNeedMore(CONTEXT, ["Show the scout row in UnitData"]);
    expect(focused.anchors.length).toBeGreaterThan(0);
    expect(focused.matched[0]?.anchorIds.length).toBeGreaterThan(0);
  });

  it("reports zero anchors when no token matches any span", () => {
    const focused = resolveNeedMore(CONTEXT, ["zzznope nothing-here xyzzy"]);
    expect(focused.anchors).toEqual([]);
    expect(focused.matched).toEqual([{ query: "zzznope nothing-here xyzzy", anchorIds: [] }]);
  });
});

describe("mergeStructured", () => {
  it("dedupes findings by statement + anchors + claims and orders by severity", () => {
    const merged = mergeStructured({
      findings: [
        {
          title: "A",
          statement: "risk",
          anchors: [ANCHOR_B_ATK],
          severity: "minor",
          confidence: "exact",
          claims: [],
        },
        {
          title: "B",
          statement: "  RISK ",
          anchors: [ANCHOR_B_ATK],
          severity: "major",
          confidence: "exact",
          claims: [],
        },
        {
          title: "C",
          statement: "other",
          anchors: [ANCHOR_B_ATK],
          severity: "critical",
          confidence: "inferred",
          claims: [],
        },
      ],
      unknowns: ["u1", "U1", "u2"],
      negativeResults: [],
      answers: [],
    });
    expect(merged.findings.map((finding) => finding.title)).toEqual(["C", "A"]);
    expect(merged.unknowns).toEqual(["u1", "u2"]);
  });
});

describe("synthesize pass", () => {
  it("sends findings, themes and anchors; records the round", async () => {
    const report = {
      verdict: "needs_review",
      qualityScore: 70,
      executiveSummary: "One change.",
      topConcerns: [],
      themes: [],
      findings: [],
      recommendedTests: [],
      unknowns: [],
    };
    const { deps, calls } = depsFor({ synthesize: report });
    const result = await runSynthesizePass(deps, {
      context: CONTEXT,
      structured: { findings: [], unknowns: [], negativeResults: [], answers: [] },
      themes: [{ id: "theme-1", name: "Data", files: [TABLE_PATH] }],
      constraints: [],
      round: 1,
    });
    expect(result.output.verdict).toBe("needs_review");
    expect(result.meta.round).toBe(1);
    expect(firstCall(calls).attachments.map((item) => item.uploadName)).toEqual([
      "task.json",
      "findings.json",
      "themes.json",
      "engine-findings.jsonl",
      "anchors.jsonl",
    ]);
  });

  it("fails with invalid-output on drift", async () => {
    const { deps } = depsFor({ synthesize: { verdict: "nope" } });
    const attempt = runSynthesizePass(deps, {
      context: CONTEXT,
      structured: { findings: [], unknowns: [], negativeResults: [], answers: [] },
      themes: [],
      constraints: [],
      round: 1,
    });
    await expect(attempt).rejects.toThrowError(AiError);
  });
});

describe("payload accounting", () => {
  it("counts what the model is sent and lists the biggest section first", () => {
    const accounting = payloadAccounting("prompt", '{"stage":"map"}', [
      { uploadName: "small.json", mimeType: "application/json", content: "ab" },
      { uploadName: "big.json", mimeType: "application/json", content: "x".repeat(500) },
    ]);
    expect(accounting.payloadBytes).toBe(6 + 15 + 2 + 500);
    expect(accounting.payloadSections.map((section) => section.name)).toEqual([
      "big.json",
      "manifest",
      "prompt",
      "small.json",
    ]);
    expect(accounting.payloadSections.reduce((sum, section) => sum + section.bytes, 0)).toBe(
      accounting.payloadBytes,
    );
  });

  it("keeps equal sizes in a stable order, so the same call always accounts the same", () => {
    const attachments = [
      { uploadName: "b.json", mimeType: "application/json", content: "xy" },
      { uploadName: "a.json", mimeType: "application/json", content: "xy" },
    ];
    const first = payloadAccounting("p", "{}", attachments);
    const second = payloadAccounting("p", "{}", attachments);
    expect(first.payloadSections).toEqual(second.payloadSections);
    expect(first.payloadSections.map((section) => section.name)).toEqual([
      "a.json",
      "b.json",
      "manifest",
      "prompt",
    ]);
  });
});

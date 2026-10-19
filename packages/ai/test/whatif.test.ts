import { describe, expect, it } from "vitest";
import {
  addTurnToLedger,
  buildWhatIfContext,
  buildWhatIfPrompt,
  emptyWhatIfLedger,
  extractQuestionKeywords,
  linkAnswer,
  PROMPT_VERSIONS,
  parseWhatIfLedger,
  runWhatIfPass,
  type WhatIfContextInput,
} from "../src/index";
import { ANCHOR_A_ATK, ANCHOR_B_MOD, makeDigest } from "./helpers/digest-fixture";
import { attachmentOf, firstCall, scriptedRunner } from "./helpers/scripted-runner";

const CONFIG = { workflowUrl: "https://example.test/run", apiKey: "k" };

const BASE_INPUT: WhatIfContextInput = {
  digest: makeDigest(),
  runSummary: null,
  ledger: emptyWhatIfLedger(),
  recentTurns: [],
  pins: [],
  question: "Tại sao _MOD đổi?",
};

function build(over: Partial<WhatIfContextInput> = {}) {
  return buildWhatIfContext({ ...BASE_INPUT, ...over });
}

describe("what-if context", () => {
  it("assembles the task pack, fact store and evidence with deterministic counts", () => {
    const context = build();
    expect(context.taskPack.baseRef).toBe("HEAD~1");
    expect(context.taskPack.currentRef).toBe("WORKTREE");
    expect(context.evidence).toHaveLength(4);
    expect(context.manifest.counts).toEqual({
      changeFacts: 2,
      linked: 1,
      contextItems: 1,
      evidence: 4,
      evidenceDropped: 0,
    });
    expect(context.factIndex.quantities.size).toBeGreaterThan(0);
    expect(build()).toEqual(context);
  });

  it("boosts pinned anchors to the front of the evidence pack", () => {
    const context = build({ pins: [{ anchorId: ANCHOR_A_ATK, note: "theo dõi" }] });
    expect(context.evidence[0]?.id).toBe(ANCHOR_A_ATK);
  });

  it("extracts keywords ignoring stopwords and punctuation", () => {
    const keywords = extractQuestionKeywords("Tại sao _MOD lại bị thay đổi trong Config.fcg?");
    expect(keywords).toContain("_mod");
    expect(keywords).toContain("config.fcg");
    expect(keywords).not.toContain("tại");
    expect(keywords).not.toContain("sao");
    expect(keywords).not.toContain("trong");
  });

  it("boosts question-matching anchors ahead of standard tiers", () => {
    const context = build({ question: "Điều gì xảy ra với scout?" });
    expect(context.evidence[0]?.snippet).toContain("scout");
  });
});

describe("what-if ledger", () => {
  it("folds answers mechanically — dedupe, cap, uptoTurn", () => {
    let ledger = emptyWhatIfLedger();
    ledger = addTurnToLedger(ledger, {
      statement: ["claim one", "claim one", "claim two"],
      unknowns: ["missing thing"],
      anchors: [ANCHOR_B_MOD, ANCHOR_B_MOD],
    });
    expect(ledger.uptoTurn).toBe(1);
    expect(ledger.claims).toEqual(["claim one", "claim two"]);
    expect(ledger.unknowns).toEqual(["missing thing"]);
    expect(ledger.anchors).toEqual([ANCHOR_B_MOD]);
    const many = addTurnToLedger(emptyWhatIfLedger(), {
      statement: Array.from({ length: 40 }, (_, index) => `claim ${index}`),
      unknowns: [],
      anchors: [],
    });
    expect(many.claims).toHaveLength(30);
    expect(many.claims[0]).toBe("claim 10");
  });

  it("parses stored ledgers defensively", () => {
    expect(parseWhatIfLedger(null)).toEqual(emptyWhatIfLedger());
    expect(parseWhatIfLedger("not json")).toEqual(emptyWhatIfLedger());
    const raw = JSON.stringify({ uptoTurn: 2, claims: ["a", 7], unknowns: [], anchors: [] });
    expect(parseWhatIfLedger(raw)).toEqual({
      uptoTurn: 2,
      claims: ["a"],
      unknowns: [],
      anchors: [],
    });
  });
});

describe("what-if pass", () => {
  const OUTPUT = { answer: "Ổn.", evidence: [], speculation: [], unknowns: [] };

  it("sends the reconstructed context and records the transport facts", async () => {
    const scripted = scriptedRunner({ whatif: OUTPUT });
    const result = await runWhatIfPass({ runner: scripted.runner, config: CONFIG }, build());
    expect(result.meta).toMatchObject({
      pass: "whatif",
      promptVersion: PROMPT_VERSIONS.whatif,
      latencyMs: 7,
      salvage: "clean",
      cached: false,
    });
    expect(result.output).toEqual(OUTPUT);
    const call = firstCall(scripted.calls);
    const names = call.attachments.map((item) => item.uploadName);
    expect(names).toEqual(["task.json", "facts.json", "history.json", "pins.jsonl"]);
    const taskFile = attachmentOf(call, "task.json");
    expect(taskFile).toBeDefined();
    expect(JSON.parse(taskFile?.content ?? "{}")).toMatchObject({ mode: "whatif" });
  });

  it("rides the latest report along when one exists", async () => {
    const scripted = scriptedRunner({ whatif: OUTPUT });
    const context = build({
      runSummary: { verdict: "needs_review", qualityScore: 80, report: { findings: [] } },
    });
    await runWhatIfPass({ runner: scripted.runner, config: CONFIG }, context);
    const names = firstCall(scripted.calls).attachments.map((item) => item.uploadName);
    expect(names).toContain("report.json");
  });

  it("builds a deterministic Vietnamese prompt with the question and memory", () => {
    const prompt = buildWhatIfPrompt(build(), "Tại sao _MOD đổi?");
    expect(prompt).toContain("VIETNAMESE");
    expect(prompt).toContain("Tại sao _MOD đổi?");
    expect(prompt).toContain("pins.jsonl");
    expect(prompt).toContain("history.json");
    expect(buildWhatIfPrompt(build(), "Tại sao _MOD đổi?")).toBe(prompt);
  });
});

describe("linkAnswer", () => {
  const digest = makeDigest();
  const index = (() => {
    const context = build();
    return context.factIndex;
  })();
  const valueQuantity = digest.quantities.find(
    (quantity) => quantity.kind === "value" && quantity.ref === "B",
  );
  if (valueQuantity === undefined) throw new Error("fixture must carry a value quantity");
  const PLACEHOLDER = `{{f:${valueQuantity.id}}}`;

  it("renders fact placeholders and keeps grounded evidence", () => {
    const result = linkAnswer(
      {
        answer: `Giá trị mới là ${PLACEHOLDER}.`,
        evidence: [{ statement: "_MOD đổi giá trị", anchors: [ANCHOR_B_MOD] }],
        speculation: [],
        unknowns: [],
      },
      index,
    );
    expect(result.answer.answer).toContain("999983");
    expect(result.answer.evidence).toHaveLength(1);
    expect(result.answer.evidence[0]?.anchors).toEqual([ANCHOR_B_MOD]);
    expect(result.issues).toEqual([]);
    expect(result.stats.numbersChecked).toBe(1);
  });

  it("demotes evidence with hallucinated anchors to speculation (never silent)", () => {
    const result = linkAnswer(
      {
        answer: "Điều gì đó đã đổi.",
        evidence: [{ statement: "Tuyên bố không có nguồn", anchors: ["B:ghost:1:1:code"] }],
        speculation: [],
        unknowns: [],
      },
      index,
    );
    expect(result.answer.evidence).toEqual([]);
    expect(result.answer.speculation).toContain("Tuyên bố không có nguồn");
    expect(result.issues.map((issue) => issue.kind)).toEqual([
      "unknown-anchor",
      "finding-unanchored",
    ]);
    expect(result.stats.anchorsStripped).toBe(1);
    expect(result.stats.findingsStripped).toBe(1);
  });

  it("marks free numbers and unknown fact ids instead of swallowing them", () => {
    const result = linkAnswer(
      {
        answer: `Bảng có 17 cột và ${PLACEHOLDER}.`,
        evidence: [],
        speculation: ["Có lẽ 5 dòng bị ảnh hưởng."],
        unknowns: [],
      },
      index,
    );
    expect(result.answer.answer).toContain("số liệu chưa truy được về fact nguồn");
    expect(result.answer.speculation[0]).toContain("số liệu chưa truy được về fact nguồn");
    expect(result.issues.some((issue) => issue.kind === "free-number")).toBe(true);
    expect(result.stats.numbersUnverified).toBeGreaterThan(0);
  });

  it("treats an unknown fact id as a blocked number", () => {
    const result = linkAnswer(
      {
        answer: "Giá trị là {{f:q:missing}}.",
        evidence: [],
        speculation: [],
        unknowns: [],
      },
      index,
    );
    expect(result.issues.some((issue) => issue.kind === "unknown-fact")).toBe(true);
    expect(result.answer.answer).toContain("số liệu chưa truy được về fact nguồn");
  });

  it("is deterministic", () => {
    const output = {
      answer: `Giá trị mới là ${PLACEHOLDER}.`,
      evidence: [{ statement: "_MOD đổi", anchors: [ANCHOR_B_MOD] }],
      speculation: ["Có thể ảnh hưởng cân bằng."],
      unknowns: ["Chưa rõ ngưỡng."],
    };
    expect(linkAnswer(output, index)).toEqual(linkAnswer(output, index));
  });
});

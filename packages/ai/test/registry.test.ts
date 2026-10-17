import { describe, expect, it } from "vitest";
import {
  buildDigestReadPrompt,
  buildDigPrompt,
  buildReviewContext,
  buildSynthesizePrompt,
  PROMPT_VERSIONS,
} from "../src/index";
import { makeDigest } from "./helpers/digest-fixture";

describe("prompt registry", () => {
  const context = buildReviewContext(makeDigest(), { goal: "Check pacing", lens: "designer" });

  it("builds deterministic digest_read prompts", () => {
    const prompt = buildDigestReadPrompt(context);
    expect(prompt).toBe(buildDigestReadPrompt(context));
    expect(prompt).toContain("digest_read");
    expect(prompt).toContain("goal: Check pacing");
    expect(prompt).toContain("lens: designer");
    expect(prompt).toContain("anchors.jsonl");
    expect(prompt).toContain("needMore");
    expect(prompt).toMatchSnapshot();
  });

  it("builds deterministic dig prompts with the queries listed", () => {
    const prompt = buildDigPrompt(
      context,
      ["UnitData reader", "CSVIndex"],
      context.evidence.slice(0, 2),
    );
    expect(prompt).toBe(
      buildDigPrompt(context, ["UnitData reader", "CSVIndex"], context.evidence.slice(0, 2)),
    );
    expect(prompt).toContain("1. UnitData reader");
    expect(prompt).toContain("2. CSVIndex");
    expect(prompt).toContain("2 anchor(s) resolved");
    expect(prompt).toMatchSnapshot();
  });

  it("builds deterministic synthesize prompts that forbid new anchors", () => {
    const prompt = buildSynthesizePrompt(context, [], []);
    expect(prompt).toBe(buildSynthesizePrompt(context, [], []));
    expect(prompt).toContain("may NOT introduce anchor ids");
    expect(prompt).toMatchSnapshot();
  });

  it("pins the prompt versions", () => {
    expect(PROMPT_VERSIONS).toEqual({ digestRead: "1.0.0", dig: "1.0.0", synthesize: "1.0.0" });
  });
});

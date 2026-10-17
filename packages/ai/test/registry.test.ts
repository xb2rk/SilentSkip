import { describe, expect, it } from "vitest";
import {
  buildDigPrompt,
  buildMapPrompt,
  buildReadPrompt,
  buildReviewContext,
  buildSynthesizePrompt,
  PROMPT_VERSIONS,
} from "../src/index";
import { makeDigest, SCRIPT_PATH, TABLE_PATH } from "./helpers/digest-fixture";

const CONTEXT = buildReviewContext(makeDigest(), { goal: "Kiểm tra thay đổi", lens: "designer" });
const THEMES = [
  { id: "theme-1", name: "Unit data", files: [TABLE_PATH] },
  { id: "theme-2", name: "Config script", files: [SCRIPT_PATH] },
];

describe("prompt registry v2", () => {
  it("builds the map prompt deterministically", () => {
    const prompt = buildMapPrompt(CONTEXT);
    expect(prompt).toContain("EXACTLY ONE theme");
    expect(prompt).toContain("skeleton.json");
    expect(prompt).toContain("Kiểm tra thay đổi");
    expect(buildMapPrompt(CONTEXT)).toBe(prompt);
    expect(prompt).toMatchSnapshot();
  });

  it("builds the read prompt with unit info, fact rules and round constraints", () => {
    const round1 = buildReadPrompt(CONTEXT, 1, 2, 1, []);
    expect(round1).toContain("Unit 1 of 2");
    expect(round1).toContain(SCRIPT_PATH);
    expect(round1).toContain("{{f:<factId>}}");
    expect(round1).not.toContain("Constraints from the previous round");
    const round2 = buildReadPrompt(CONTEXT, 2, 2, 2, ["STRUCT-01: Row width differs — anchors: x"]);
    expect(round2).toContain("Constraints from the previous round");
    expect(round2).toContain("STRUCT-01");
    expect(round2).toContain("Unit 2 of 2");
    expect(buildReadPrompt(CONTEXT, 1, 2, 1, [])).toBe(round1);
    expect(round2).toMatchSnapshot();
  });

  it("builds the dig prompt over resolved anchors", () => {
    const prompt = buildDigPrompt(
      CONTEXT,
      ["scout chính xác đổi thế nào?"],
      CONTEXT.evidence.slice(0, 1),
    );
    expect(prompt).toContain("1 anchor(s) resolved");
    expect(prompt).toContain("scout chính xác đổi thế nào?");
    expect(prompt).toContain("no further round");
    expect(prompt).toMatchSnapshot();
  });

  it("builds the synthesize prompt with theme ids and linked findings", () => {
    const prompt = buildSynthesizePrompt(CONTEXT, 2, THEMES, 1, []);
    expect(prompt).toContain("theme-1, theme-2");
    expect(prompt).toContain("linked findings: 2");
    expect(prompt).toContain("may NOT add anchors");
    const withConstraints = buildSynthesizePrompt(CONTEXT, 2, THEMES, 1, [
      "new-anchor: t — not seen",
    ]);
    expect(withConstraints).toContain("Constraints from the previous round");
    expect(buildSynthesizePrompt(CONTEXT, 2, THEMES, 1, [])).toBe(prompt);
    expect(prompt).toMatchSnapshot();
  });

  it("pins the prompt versions", () => {
    expect(PROMPT_VERSIONS).toEqual({
      map: "2.0.0",
      read: "2.0.0",
      dig: "2.0.0",
      synthesize: "2.0.0",
    });
  });
});

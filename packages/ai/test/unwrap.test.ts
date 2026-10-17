import { describe, expect, it } from "vitest";
import { parseResultText, unwrapWorkflowPayload } from "../src/index";

describe("unwrapWorkflowPayload", () => {
  it("unwraps the standard { data: { outputs: { result } } } envelope", () => {
    const payload = {
      data: { status: "succeeded", outputs: { result: '{"verdict":"pass"}' } },
    };
    const { output, salvage } = unwrapWorkflowPayload(payload);
    expect(output).toEqual({ verdict: "pass" });
    expect(salvage).toBe("clean");
  });

  it("unwraps { outputs: { result } } without the data layer", () => {
    const { output } = unwrapWorkflowPayload({ outputs: { result: '{"a":1}' } });
    expect(output).toEqual({ a: 1 });
  });

  it("passes through { output: object } and { data: object } envelopes", () => {
    expect(unwrapWorkflowPayload({ output: { x: 2 } }).output).toEqual({ x: 2 });
    expect(unwrapWorkflowPayload({ data: { status: "succeeded" } }).output).toEqual({
      status: "succeeded",
    });
  });

  it("parses { output: string } and { result: string }", () => {
    expect(unwrapWorkflowPayload({ output: '{"y":3}' }).output).toEqual({ y: 3 });
    expect(unwrapWorkflowPayload({ result: '{"z":4}' }).output).toEqual({ z: 4 });
  });

  it("keeps a plain object as-is and never fabricates structure for non-objects", () => {
    expect(unwrapWorkflowPayload({ plain: true }).output).toEqual({ plain: true });
    expect(unwrapWorkflowPayload("text").output).toEqual({});
  });
});

describe("parseResultText", () => {
  it("strips reasoning tags before parsing and reports the salvage rung", () => {
    const openTag = ["<", "think", ">"].join("");
    const closeTag = ["</", "think", ">"].join("");
    const result = parseResultText(`${openTag}weighing options${closeTag}{"ok":true}`);
    expect(result.output).toEqual({ ok: true });
    expect(result.salvage).toBe("stripped");
  });

  it("extracts JSON from a markdown fence", () => {
    const result = parseResultText('Here you go:\n```json\n{"ok":true}\n```\n');
    expect(result.output).toEqual({ ok: true });
    expect(result.salvage).toBe("fence");
  });

  it("extracts the outermost braces from prose", () => {
    const result = parseResultText('The answer is {"a": [1, 2]} as requested.');
    expect(result.output).toEqual({ a: [1, 2] });
    expect(result.salvage).toBe("braces");
  });

  it("falls back to raw text under executiveSummary — never fabricates structure", () => {
    const result = parseResultText("I could not produce JSON.");
    expect(result.output).toEqual({ executiveSummary: "I could not produce JSON." });
    expect(result.salvage).toBe("text-fallback");
  });
});

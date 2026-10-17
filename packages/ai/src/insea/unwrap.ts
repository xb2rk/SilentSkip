import type { InseaSalvage } from "./types.js";

/**
 * Unwrap the Insea response envelope down to the model's result text.
 *
 * Supported shapes (all observed across workflow versions):
 * - `{ data: { outputs: { result: "<string>" } } }` — the standard envelope
 * - `{ outputs: { result: "<string>" } }`
 * - `{ output: {...} }` / `{ output: "<string>" }` / `{ result: "<string>" }`
 *
 * When the payload is already a plain object (no result text), `rawResult` is `null` and the
 * object itself is the output. Non-object payloads yield an empty output — never a crash.
 */
export function unwrapWorkflowPayload(payload: unknown): {
  output: Record<string, unknown>;
  rawResult: string | null;
  salvage: InseaSalvage;
} {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { output: {}, rawResult: null, salvage: "text-fallback" };
  }
  const obj = payload as Record<string, unknown>;

  const data = obj.data;
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    const dataObj = data as Record<string, unknown>;
    const outputs = dataObj.outputs;
    if (outputs !== null && typeof outputs === "object" && !Array.isArray(outputs)) {
      const result = (outputs as Record<string, unknown>).result;
      if (typeof result === "string") return parseResultText(result);
    }
    return { output: dataObj, rawResult: null, salvage: "clean" };
  }

  const outputs = obj.outputs;
  if (outputs !== null && typeof outputs === "object" && !Array.isArray(outputs)) {
    const result = (outputs as Record<string, unknown>).result;
    if (typeof result === "string") return parseResultText(result);
  }

  const output = obj.output;
  if (output !== null && typeof output === "object" && !Array.isArray(output)) {
    return { output: output as Record<string, unknown>, rawResult: null, salvage: "clean" };
  }
  if (typeof output === "string") return parseResultText(output);

  const result = obj.result;
  if (typeof result === "string") return parseResultText(result);

  return { output: obj, rawResult: null, salvage: "clean" };
}

const THINK_PATTERN = /<think[\s\S]*?<\/think>/gi;

/**
 * Recover a JSON object from model result text.
 *
 * Salvage ladder — each rung is recorded honestly in `salvage`:
 * 1. strip reasoning tags, then parse as-is
 * 2. extract the first markdown fence
 * 3. extract the outermost `{…}` span
 * 4. give up: keep the text under `executiveSummary` — never fabricate structure
 */
export function parseResultText(result: string): {
  output: Record<string, unknown>;
  rawResult: string;
  salvage: InseaSalvage;
} {
  const withoutThink = result.replace(THINK_PATTERN, "").trim();
  const stripped = withoutThink !== result.trim();

  const direct = tryParseObject(withoutThink);
  if (direct !== undefined) {
    return { output: direct, rawResult: result, salvage: stripped ? "stripped" : "clean" };
  }

  const fenced = tryParseObject(unfence(withoutThink));
  if (fenced !== undefined) {
    return { output: fenced, rawResult: result, salvage: "fence" };
  }

  const firstBrace = withoutThink.indexOf("{");
  const lastBrace = withoutThink.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const braced = tryParseObject(withoutThink.slice(firstBrace, lastBrace + 1));
    if (braced !== undefined) {
      return { output: braced, rawResult: result, salvage: "braces" };
    }
  }

  return {
    output: { executiveSummary: withoutThink },
    rawResult: result,
    salvage: "text-fallback",
  };
}

function unfence(text: string): string {
  const match = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (match?.[1] !== undefined) return match[1].trim();
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function tryParseObject(text: string): Record<string, unknown> | undefined {
  if (text === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to the next salvage rung
  }
  return undefined;
}

import { afterEach, describe, expect, it, vi } from "vitest";
import { AiError, canaryProbe, runInseaWorkflow } from "../src/index";

const BASE_REQUEST = {
  url: "https://example.test/run",
  apiKey: "test-key",
  prompt: "hello",
  manifestJson: '{"version":"1.0.0"}',
  attachments: [{ uploadName: "file-0001.txt", content: "data", mimeType: "text/plain" }],
} as const;

interface MockInit {
  method?: string;
  headers?: unknown;
  body?: unknown;
  signal?: AbortSignal | null;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("runInseaWorkflow", () => {
  it("posts the multipart contract and unwraps the envelope", async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: MockInit) => {
      expect(String(url)).toBe("https://example.test/run");
      expect(init?.method).toBe("POST");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-key");
      const form = init?.body as FormData;
      expect(form.get("Prompt")).toBe("hello");
      expect(form.get("Manifest")).toBe('{"version":"1.0.0"}');
      expect(form.getAll("DataList")).toHaveLength(1);
      return jsonResponse({ data: { outputs: { result: '{"ok":true}' } } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runInseaWorkflow({ ...BASE_REQUEST });
    expect(result.output).toEqual({ ok: true });
    expect(result.salvage).toBe("clean");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("attaches the manifest itself when there are no attachments (endpoint requires ≥1)", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: MockInit) => {
      const form = init?.body as FormData;
      expect(form.getAll("DataList")).toHaveLength(1);
      return jsonResponse({ data: { outputs: { result: '{"ok":true}' } } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await runInseaWorkflow({ ...BASE_REQUEST, attachments: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws not-configured when url or key is missing", async () => {
    await expect(runInseaWorkflow({ ...BASE_REQUEST, url: "" })).rejects.toMatchObject({
      code: "not-configured",
    });
    await expect(runInseaWorkflow({ ...BASE_REQUEST, apiKey: " " })).rejects.toMatchObject({
      code: "not-configured",
    });
  });

  it("maps HTTP failures to http-error with a body preview", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 401 }));
    const error = await runInseaWorkflow({ ...BASE_REQUEST }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect(error).toMatchObject({ code: "http-error", status: 401 });
  });

  it("maps a non-JSON 2xx body to http-error instead of pretending success", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>", { status: 200 }));
    await expect(runInseaWorkflow({ ...BASE_REQUEST })).rejects.toMatchObject({
      code: "http-error",
    });
  });

  it("distinguishes user cancellation from timeout", async () => {
    const hangingFetch = (_url: unknown, init?: MockInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const abortError = new Error("aborted");
          abortError.name = "AbortError";
          reject(abortError);
        });
      });

    vi.stubGlobal("fetch", hangingFetch);
    const controller = new AbortController();
    const cancelPromise = runInseaWorkflow({
      ...BASE_REQUEST,
      timeoutMs: 5_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    await expect(cancelPromise).rejects.toMatchObject({ code: "cancelled" });

    vi.stubGlobal("fetch", hangingFetch);
    await expect(runInseaWorkflow({ ...BASE_REQUEST, timeoutMs: 20 })).rejects.toMatchObject({
      code: "timeout",
    });
  });
});

describe("canaryProbe", () => {
  it("reports ok only when the model honoured the JSON contract", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse({ data: { outputs: { result: '{"ok": true, "purpose": "canary"}' } } }),
    );
    const result = await canaryProbe({ workflowUrl: "https://example.test/run", apiKey: "k" });
    expect(result.ok).toBe(true);
    expect(result.salvage).toBe("clean");
  });

  it("reports ok:false when the answer drifts, without throwing", async () => {
    vi.stubGlobal("fetch", async () =>
      jsonResponse({ data: { outputs: { result: "I am not JSON" } } }),
    );
    const result = await canaryProbe({ workflowUrl: "https://example.test/run", apiKey: "k" });
    expect(result.ok).toBe(false);
    expect(result.salvage).toBe("text-fallback");
  });
});

import { AiError } from "../errors.js";
import type { InseaRunRequest, InseaRunResult } from "./types.js";
import { unwrapWorkflowPayload } from "./unwrap.js";

/** Default per-request timeout when the caller does not pass one. */
export const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * Execute one stateless Insea workflow run over multipart/form-data.
 *
 * Contract notes:
 * - Fields are exactly `Prompt`, `Manifest` and repeated `DataList` — the endpoint requires at
 *   least one attachment, so an empty list attaches the manifest itself.
 * - Auth is `Authorization: Bearer <key>`.
 * - The response envelope is unwrapped and the result text salvaged to a JSON object; the
 *   salvage rung is reported, never hidden.
 * - Cancellation and timeout are distinguished: user cancels raise `cancelled`, elapsed
 *   timeouts raise `timeout` — the UI shows different messages for each.
 */
export async function runInseaWorkflow(request: InseaRunRequest): Promise<InseaRunResult> {
  if (request.url.trim() === "" || request.apiKey.trim() === "") {
    throw new AiError(
      "not-configured",
      "Insea workflow is not configured (AI_WORKFLOW_URL / AI_WORKFLOW_API_KEY)",
    );
  }

  const formData = new FormData();
  formData.append("Prompt", request.prompt);
  formData.append("Manifest", request.manifestJson);
  if (request.attachments.length === 0) {
    formData.append(
      "DataList",
      new Blob([request.manifestJson === "" ? "{}" : request.manifestJson], {
        type: "application/json",
      }),
      "manifest.json",
    );
  } else {
    for (const attachment of request.attachments) {
      formData.append(
        "DataList",
        new Blob([attachment.content], { type: attachment.mimeType }),
        attachment.uploadName,
      );
    }
  }

  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    timeoutController.abort(new Error(`Insea workflow timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  const signal =
    request.signal === undefined
      ? timeoutController.signal
      : AbortSignal.any([request.signal, timeoutController.signal]);

  const startedAt = performance.now();
  try {
    const response = await fetch(request.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${request.apiKey}` },
      body: formData,
      signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AiError("http-error", `Insea workflow failed with HTTP ${response.status}`, {
        status: response.status,
        details: body.slice(0, 500),
      });
    }

    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new AiError("http-error", "Insea workflow returned a non-JSON response", {
        status: response.status,
        details: text.slice(0, 500),
      });
    }

    const { output, rawResult, salvage } = unwrapWorkflowPayload(payload);
    return {
      output,
      rawResult: rawResult ?? JSON.stringify(output),
      salvage,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (request.signal?.aborted === true) {
      throw new AiError("cancelled", "Insea workflow was cancelled", { cause: error });
    }
    if (timeoutController.signal.aborted) {
      throw new AiError("timeout", `Insea workflow timed out after ${timeoutMs}ms`, {
        cause: error,
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new AiError("network", `Failed to reach the Insea workflow: ${message}`, {
      cause: error,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

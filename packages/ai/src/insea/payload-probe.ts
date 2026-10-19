import type { InseaAttachment, InseaRunRequest } from "./types.js";

/**
 * Payload probe (Phase 5) — the pure half: reshape a **captured** production request so the cost of
 * each part of it can be measured.
 *
 * The requests `payload:probe` measures are captured from the pipeline's own runner, never rebuilt
 * here: a probe that re-assembled context itself would silently stop measuring what the pipeline
 * sends. This module only drops, pads or re-prompts a request that really went out.
 */

/** How to reshape a captured request. Every field is optional; absent means "leave it alone". */
export interface PayloadVariant {
  /** Label used in the probe report. */
  readonly name: string;
  /** Keep only these attachments (`task.json`, `unit.json`, `bodies.jsonl`, …). */
  readonly keep?: readonly string[];
  /** Drop these attachments. */
  readonly drop?: readonly string[];
  /** Send no `DataList` entries at all: the client then ships the manifest as the only file. */
  readonly emptyAttachments?: boolean;
  /** Send an unusable `Manifest` (`{}`) — can the workflow still read the `DataList`? */
  readonly emptyManifest?: boolean;
  /** Append a filler attachment of this many bytes: the byte→latency slope probe. */
  readonly padBytes?: number;
  /** Replace the prompt (the token-hunt variant). */
  readonly prompt?: string;
  /** Append one more attachment (the token-hunt variant). */
  readonly extraAttachment?: InseaAttachment;
}

/**
 * Reshape a captured request. The `Manifest` is rebuilt from the attachments that survive, so the
 * manifest never claims files the model was not given — the disagreement a naive ablation would
 * introduce, and the kind of thing this probe exists to measure honestly.
 */
export function applyPayloadVariant(
  request: InseaRunRequest,
  variant: PayloadVariant,
): InseaRunRequest {
  let attachments = request.attachments;
  if (variant.keep !== undefined) {
    const keep = new Set(variant.keep);
    attachments = attachments.filter((attachment) => keep.has(attachment.uploadName));
  }
  if (variant.drop !== undefined) {
    const drop = new Set(variant.drop);
    attachments = attachments.filter((attachment) => !drop.has(attachment.uploadName));
  }
  if (variant.emptyAttachments === true) attachments = [];
  if (variant.padBytes !== undefined && variant.padBytes > 0) {
    attachments = [...attachments, fillerAttachment(variant.padBytes)];
  }
  if (variant.extraAttachment !== undefined) {
    attachments = [...attachments, variant.extraAttachment];
  }
  return {
    ...request,
    prompt: variant.prompt ?? request.prompt,
    manifestJson:
      variant.emptyManifest === true ? "{}" : rebuildManifest(request.manifestJson, attachments),
    attachments,
  };
}

/** Filler input, named so a report can never mistake it for project content. */
export function fillerAttachment(bytes: number): InseaAttachment {
  return {
    uploadName: "probe-filler.txt",
    mimeType: "text/plain",
    content: "x".repeat(bytes),
  };
}

/**
 * Rewrite the manifest's `files` list to match `attachments`, keeping every other manifest key and
 * each surviving file's `kind`. Byte sizes are recomputed, so the report reflects what is really
 * uploaded. An unparseable manifest is left untouched — there is nothing honest to rewrite.
 */
export function rebuildManifest(
  manifestJson: string,
  attachments: readonly InseaAttachment[],
): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(manifestJson) as Record<string, unknown>;
  } catch {
    return manifestJson;
  }
  const previous = Array.isArray(parsed.files) ? (parsed.files as unknown[]) : [];
  const kindOf = (uploadName: string): string => {
    for (const entry of previous) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as { readonly uploadName?: unknown; readonly kind?: unknown };
      if (record.uploadName === uploadName && typeof record.kind === "string") return record.kind;
    }
    return "other";
  };
  return JSON.stringify({
    ...parsed,
    files: attachments.map((attachment) => ({
      uploadName: attachment.uploadName,
      relativePath: attachment.uploadName,
      kind: kindOf(attachment.uploadName),
      byteSize: Buffer.byteLength(attachment.content, "utf8"),
    })),
  });
}

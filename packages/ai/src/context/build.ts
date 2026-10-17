import type { DigestBundle } from "@craftland-qa/contracts";
import type { InseaAttachment } from "../insea/types.js";
import {
  CONTEXT_BUDGETS,
  type EvidenceAnchor,
  type ReviewContext,
  type ReviewContextInput,
} from "./types.js";

/**
 * Assemble the context of a review run from a digest.
 *
 * Deterministic: anchors keep the digest order, budgets drop from the tail and record the
 * dropped count in the manifest. No clocks, no environment reads — the same digest always
 * produces the same context, which is what keeps runs and evals reproducible.
 */
export function buildReviewContext(
  digest: DigestBundle,
  input: ReviewContextInput = {},
): ReviewContext {
  const allEvidence: EvidenceAnchor[] = digest.anchors.map((anchor) => ({
    id: anchor.id,
    ref: anchor.ref,
    file: anchor.file,
    lineStart: anchor.lineStart,
    lineEnd: anchor.lineEnd,
    kind: anchor.kind,
    snippet: anchor.snippet,
  }));

  const notes: string[] = [];
  let evidence = allEvidence.slice(0, CONTEXT_BUDGETS.maxEvidenceAnchors);
  const droppedByCount = allEvidence.length - evidence.length;
  while (
    evidence.length > 0 &&
    Buffer.byteLength(serializeAnchorsJsonl(evidence), "utf8") > CONTEXT_BUDGETS.maxEvidenceBytes
  ) {
    evidence = evidence.slice(0, evidence.length - 1);
  }
  const dropped = allEvidence.length - evidence.length;
  if (dropped > 0) {
    notes.push(
      `evidence anchors dropped: ${dropped} (by count: ${droppedByCount}, by bytes: ${dropped - droppedByCount})`,
    );
  }

  return {
    taskPack: {
      baseRef: digest.refs.base.ref,
      currentRef: digest.refs.current.ref,
      baseCommit: digest.refs.base.commitHash,
      currentCommit: digest.refs.current.commitHash,
      stats: digest.stats,
      goal: (input.goal ?? "").trim(),
      lens: input.lens ?? "both",
    },
    changeFacts: digest.changeFacts,
    linked: digest.linked,
    contextItems: digest.context,
    evidence,
    manifest: {
      counts: {
        changeFacts: digest.changeFacts.length,
        linked: digest.linked.length,
        contextItems: digest.context.length,
        evidence: evidence.length,
        evidenceDropped: dropped,
      },
      notes,
    },
  };
}

/** Serialize anchors as JSON lines — the `anchors.jsonl` attachment format. */
export function serializeAnchorsJsonl(anchors: readonly EvidenceAnchor[]): string {
  return anchors.map((anchor) => JSON.stringify(anchor)).join("\n");
}

/** Serialize the task pack as `task.json` — shared by every pass. */
export function serializeTaskFile(context: ReviewContext): InseaAttachment {
  const { taskPack } = context;
  return attachment(
    "task.json",
    "application/json",
    JSON.stringify(
      {
        refs: {
          base: { ref: taskPack.baseRef, commitHash: taskPack.baseCommit },
          current: { ref: taskPack.currentRef, commitHash: taskPack.currentCommit },
        },
        stats: taskPack.stats,
        goal: taskPack.goal,
        lens: taskPack.lens,
      },
      null,
      2,
    ),
  );
}

/** Serialize the standard context files for pass 1 (`digest_read`). */
export function serializeContextFiles(context: ReviewContext): InseaAttachment[] {
  return [
    serializeTaskFile(context),
    attachment("changes.json", "application/json", JSON.stringify(context.changeFacts, null, 2)),
    attachment("journeys.json", "application/json", JSON.stringify(context.linked, null, 2)),
    attachment("context.json", "application/json", JSON.stringify(context.contextItems, null, 2)),
    attachment("anchors.jsonl", "application/x-ndjson", serializeAnchorsJsonl(context.evidence)),
  ];
}

/** Build the Insea `Manifest` field — exactly what was sent, with real byte sizes. */
export function buildPassManifestJson(
  stage: string,
  context: ReviewContext,
  attachments: readonly InseaAttachment[],
): string {
  return JSON.stringify({
    version: "1.0.0",
    stage,
    goal: context.taskPack.goal,
    lens: context.taskPack.lens,
    baseRef: context.taskPack.baseRef,
    currentRef: context.taskPack.currentRef,
    files: attachments.map((item) => ({
      uploadName: item.uploadName,
      relativePath: item.uploadName,
      kind: manifestKind(item.uploadName),
      byteSize: Buffer.byteLength(item.content, "utf8"),
    })),
  });
}

function attachment(uploadName: string, mimeType: string, content: string): InseaAttachment {
  return { uploadName, content, mimeType };
}

function manifestKind(uploadName: string): "code" | "csv" | "diff" | "summary" | "other" {
  if (uploadName === "changes.json") return "diff";
  if (uploadName === "task.json") return "summary";
  return "other";
}

import type {
  DigestChangeFact,
  DigestContextItem,
  DigestLinked,
  DigestStats,
  ReviewLens,
} from "@craftland-qa/contracts";

/**
 * Context assembly types — everything a pass sees, and the honest accounting of it.
 *
 * The Insea service is stateless: each call gets a TaskPack (what to review), the digest's
 * change facts and journeys, a glossary, and an evidence pack of anchors. `manifest` records
 * exactly what was sent (and what was dropped by budget) so runs stay auditable.
 */

/** One evidence anchor as sent to a pass — a strict subset of the digest anchor. */
export interface EvidenceAnchor {
  readonly id: string;
  readonly ref: "A" | "B";
  readonly file: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly kind: "csv" | "code" | "contract" | "diff";
  readonly snippet: string;
}

/** What is being reviewed and why. */
export interface TaskPack {
  readonly baseRef: string;
  readonly currentRef: string;
  readonly baseCommit: string | null;
  readonly currentCommit: string | null;
  readonly stats: DigestStats;
  readonly goal: string;
  readonly lens: ReviewLens;
}

/** Honest accounting of the context actually sent. */
export interface ReviewContextManifest {
  readonly counts: {
    readonly changeFacts: number;
    readonly linked: number;
    readonly contextItems: number;
    readonly evidence: number;
    readonly evidenceDropped: number;
  };
  readonly notes: readonly string[];
}

/** Everything a review pass reads. Deterministic for the same digest + goal + lens. */
export interface ReviewContext {
  readonly taskPack: TaskPack;
  readonly changeFacts: readonly DigestChangeFact[];
  readonly linked: readonly DigestLinked[];
  readonly contextItems: readonly DigestContextItem[];
  readonly evidence: readonly EvidenceAnchor[];
  readonly manifest: ReviewContextManifest;
}

/** Input of context assembly. */
export interface ReviewContextInput {
  readonly goal?: string;
  readonly lens?: ReviewLens;
}

/** Per-section budgets — attention-quality levers, recorded in the manifest when they bite. */
export const CONTEXT_BUDGETS = {
  maxEvidenceAnchors: 200,
  maxEvidenceBytes: 600_000,
} as const;

import type {
  DigestChangeFact,
  DigestContextItem,
  DigestFinding,
  DigestLinked,
  DigestPlan,
  DigestQuantity,
  DigestStats,
  ReviewLens,
} from "@craftland-qa/contracts";

/**
 * Context assembly types (v2, E7.2) — everything a pass sees, and the honest accounting of it.
 *
 * The Insea service is stateless: each call gets a TaskPack (what to review) plus the digest
 * payloads a pass needs — change facts, journeys, the reading plan, the fact store, engine
 * findings — and a budgeted evidence pack of anchors. `manifest` records exactly what was sent
 * (and what was dropped by budget) so runs stay auditable.
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
  /** The reading plan: units (this is what `read` passes iterate) + skeleton + partition. */
  readonly plan: DigestPlan;
  /** The fact store — every number the model may cite travels through one of these ids. */
  readonly quantities: readonly DigestQuantity[];
  /** Engine findings (layer 3) that the reading flow must interpret — never sampled. */
  readonly engineFindings: readonly DigestFinding[];
  readonly manifest: ReviewContextManifest;
}

/** Input of context assembly. */
export interface ReviewContextInput {
  readonly goal?: string;
  readonly lens?: ReviewLens;
}

/** Per-section budgets — attention-quality levers, recorded in the manifest when they bite. */
export const CONTEXT_BUDGETS = {
  maxEvidenceAnchors: 600,
  maxEvidenceBytes: 1_800_000,
} as const;

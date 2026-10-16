import type { ProjectProfile } from "@craftland-qa/contracts";
import type { SourceInput } from "../facts/index.js";

/** Digest schema version — bump when the shape of `DigestBundle` changes. */
export const DIGEST_SCHEMA_VERSION = 1;

/** Default cap on linked journeys selected per digest (attention budget, §5.3). */
export const DEFAULT_MAX_JOURNEYS = 12;

/** Default recorded anchor budget; anchors are never dropped (citation integrity wins). */
export const DEFAULT_MAX_ANCHORS = 500;

/** One side of the comparison: the ref label, its commit (null for the worktree) and files. */
export interface DigestSideInput {
  ref: string;
  commitHash: string | null;
  sources: readonly SourceInput[];
}

/** Selection budgets for the digest; all defaults apply when omitted. */
export interface DigestBudgets {
  maxJourneys?: number;
  maxAnchors?: number;
}

/** Everything `buildDigest` needs: both sides, the optional pinned profile, budgets. */
export interface DigestInput {
  base: DigestSideInput;
  current: DigestSideInput;
  profile?: ProjectProfile;
  budgets?: DigestBudgets;
}

import type { ProjectProfile } from "@craftland-qa/contracts";
import type { SourceInput } from "../facts/index.js";

/** Digest schema version — bump when the shape of `DigestBundle` changes. */
export const DIGEST_SCHEMA_VERSION = 4;

/** Default cap of total function-body material shipped in the digest (E7.5 reading depth). */
export const DEFAULT_BODY_BUDGET_BYTES = 400_000;

/** Per-function body cap; longer bodies are truncated with an honest `truncated` flag. */
export const DEFAULT_BODY_BYTES_PER_FUNCTION = 4_096;

/** Default cap on linked journeys selected per digest (attention budget, §5.3). */
export const DEFAULT_MAX_JOURNEYS = 60;

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
  /** Optional override of the reading-plan unit byte budget (default 60 KB). */
  unitBudgetBytes?: number;
  /** Optional override of the total body-material budget (default 400 KB). */
  bodyBudgetBytes?: number;
}

/** Everything `buildDigest` needs: both sides, the optional pinned profile, budgets. */
export interface DigestInput {
  base: DigestSideInput;
  current: DigestSideInput;
  profile?: ProjectProfile;
  budgets?: DigestBudgets;
}

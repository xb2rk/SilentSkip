/**
 * Shared scaffolding of the REF checks: the info-finding shape and the rule tag.
 *
 * Both REF-01 (single-value FKs) and REF-02 (structured cells) report unverifiable situations
 * as `info`/`exact` findings with `effectConfidence: inferred`, so the helper is central here to
 * keep the rule id honest per file.
 */

import type { CheckFinding } from "./types.js";

/** One `info` finding of the given REF rule; never claims a runtime effect. */
export function refInfoFinding(
  ruleId: string,
  id: string,
  title: string,
  message: string,
  anchors: string[],
  derivation: string[],
): CheckFinding {
  return {
    id,
    ruleId,
    severity: "info",
    confidence: "exact",
    effectConfidence: "inferred",
    title,
    message,
    anchors,
    derivation,
  };
}

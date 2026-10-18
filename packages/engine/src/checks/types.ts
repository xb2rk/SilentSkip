/**
 * Engine checks — deterministic findings that run over the full scope, never sampled.
 *
 * A check consumes facts (never raw pattern matching on source text), proves a statement with
 * spans on both sides, and emits `CheckFinding`s whose anchors are registered into the digest
 * anchor registry. Checks are pure functions of their `CheckInput`: same input, same findings.
 *
 * Severity/confidence semantics follow spec §4.7: `exact` means every step of the derivation
 * is a recorded fact; `inferred` means a documented assumption was needed and the finding is
 * soft (never a hard block). Only `exact` findings may carry `critical`/`major` severity.
 */

import type { ProjectProfile } from "@craftland-qa/contracts";
import type { CsvTable } from "../csv/index.js";
import type { DeltaBundle } from "../delta/index.js";
import type { FactSpan, FileFacts } from "../facts/index.js";
import type { RelationSet } from "../relations/index.js";

/** Version of the check-finding JSON shape; bump when the structure changes. */
export const CHECKS_SCHEMA_VERSION = 1;

/** Finding severity — same vocabulary as spec §4.7. */
export type CheckSeverity = "critical" | "major" | "minor" | "info";

/** Finding confidence — `exact` = fully fact-derived; `inferred` = documented assumption. */
export type CheckConfidence = "exact" | "inferred";

/** One side (A or B) of the comparison as the checks layer sees it. */
export interface CheckSide {
  readonly ref: "A" | "B";
  readonly sources: ReadonlyMap<string, string>;
  readonly factsByPath: ReadonlyMap<string, FileFacts>;
  readonly tables: ReadonlyMap<string, CsvTable>;
}

/** Registers a raw span as a digest anchor and returns the stable anchor id. */
export type RegisterAnchor = (
  ref: "A" | "B",
  file: string,
  span: FactSpan,
  kind: "csv" | "code",
) => string;

/** Everything one check run may read. */
export interface CheckInput {
  readonly base: CheckSide;
  readonly current: CheckSide;
  readonly delta: DeltaBundle;
  readonly registerAnchor: RegisterAnchor;
  /** Project profile (pins) — absent means pure engine conventions: first-column keys, no pins. */
  readonly profile?: ProjectProfile;
  /** Relations of the current side — lets binding checks see which tables code already names. */
  readonly relations?: RelationSet;
}

/** A deterministic finding produced by one check. */
export interface CheckFinding {
  /** Stable identity: `${ruleId}|${targetKey}`. */
  readonly id: string;
  readonly ruleId: string;
  readonly severity: CheckSeverity;
  readonly confidence: CheckConfidence;
  /**
   * How certain the runtime effect is. The observation behind `confidence` can be exact while
   * the consequence (a loader skipping a row, a consumer being disabled) is only a convention.
   */
  readonly effectConfidence?: "exact" | "inferred" | "unknown";
  readonly title: string;
  readonly message: string;
  /** Anchor ids of the witnesses, in reading order. */
  readonly anchors: string[];
  /** Human-readable steps that produced this finding — every step traceable to facts. */
  readonly derivation: string[];
}

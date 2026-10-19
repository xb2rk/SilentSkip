/**
 * Built-in checks (E7.1 baseline + E7.3 checks full): pure functions over `CheckInput`.
 *
 * Modular architecture:
 * - `structure.ts` — STRUCT-01 (widths), STRUCT-02 (row keys), STRUCT-03 (header hygiene), DRIFT-01 (header drift)
 * - `types-check.ts` — TYPE-01 (declared type row & leading-zero format)
 * - `bindings.ts` — BIND-03 (candidate enum bindings), BIND-04 (orphan tables)
 * - `readers.ts` — BIND-01 (missing pinned column), BIND-02 (OOB/trailing width mismatch)
 * - `ref-fk.ts` / `ref-structured.ts` — REF-01 (foreign key reference broken), REF-02 (structured cell reference broken)
 * - `localization.ts` — LOC-01 (localization table placeholders & key missing)
 * - `scripts.ts` — CALL-ARITY-01 (call argument arity mismatch), ORPHAN-ADD-01 (unreferenced added function), DANGLING-REF (dangling removed symbol)
 *
 * Severity/confidence semantics follow spec §4.7 + decision #28: `exact` means every derivation
 * step is a recorded fact; `inferred` findings stay soft (severity is kept, but the message says
 * what to pin to make them exact).
 */

import { checkBindings } from "./bindings.js";
import { checkLocalization } from "./localization.js";
import { checkReaderProfile } from "./readers.js";
import { checkForeignKeys } from "./ref-fk.js";
import { checkStructuredReferences } from "./ref-structured.js";
import { checkCallArity, checkDanglingReferences, checkOrphanAdditions } from "./scripts.js";
import {
  checkHeaderDrift,
  checkHeaderHygiene,
  checkRowKeys,
  checkTableWidths,
} from "./structure.js";
import type { CheckFinding, CheckInput } from "./types.js";
import { checkTypeRows } from "./types-check.js";

// Re-export individual checks for modular unit testing and direct inspection
export { checkBindings } from "./bindings.js";
export { checkLocalization } from "./localization.js";
export { checkReaderProfile } from "./readers.js";
export { checkForeignKeys } from "./ref-fk.js";
export { checkStructuredReferences } from "./ref-structured.js";
export { checkCallArity, checkDanglingReferences, checkOrphanAdditions } from "./scripts.js";
export {
  checkHeaderDrift,
  checkHeaderHygiene,
  checkRowKeys,
  checkTableWidths,
} from "./structure.js";
export { checkTypeRows } from "./types-check.js";

/**
 * Runs every shipped check and returns findings sorted deterministically by id.
 */
export function runChecks(input: CheckInput): CheckFinding[] {
  const findings: CheckFinding[] = [
    ...checkTableWidths(input),
    ...checkRowKeys(input),
    ...checkHeaderHygiene(input),
    ...checkHeaderDrift(input),
    ...checkTypeRows(input),
    ...checkBindings(input),
    ...checkReaderProfile(input),
    ...checkForeignKeys(input),
    ...checkStructuredReferences(input),
    ...checkLocalization(input),
    ...checkDanglingReferences(input),
    ...checkCallArity(input),
    ...checkOrphanAdditions(input),
  ];
  return findings.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

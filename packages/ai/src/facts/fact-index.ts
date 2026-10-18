import type {
  DigestBundle,
  DigestFinding,
  DigestQuantity,
  TypedClaim,
} from "@silentskip/contracts";
import type { EvidenceAnchor } from "../context/types.js";

/**
 * The fact index (E7.2, decision #28) — the AI-side view of the engine's fact store.
 *
 * Mechanism: model text never carries numbers as free digits. Statements reference facts as
 * `{{f:<factId>}}` placeholders which the renderer fills from engine-computed quantities, and
 * structural comparisons travel as typed claims that the engine evaluates itself. This module
 * owns that arithmetic — placeholders, claim evaluation and the free-number scan — so the
 * linker stays pure set/type logic.
 */

/** Placeholder pattern: `{{f:<factId>}}` — the only legal way to write a number. */
const PLACEHOLDER_PATTERN = /\{\{f:([^}]+)\}\}/gu;

/** The index a review run builds once from its digest. */
export interface FactIndex {
  /** Every quantity by id — numbers the model may cite. */
  readonly quantities: ReadonlyMap<string, DigestQuantity>;
  /** Every digest anchor by id — the citation registry (full, not the budgeted pack). */
  readonly anchors: ReadonlyMap<string, EvidenceAnchor>;
  /** Engine findings of this digest (layer 3). */
  readonly engineFindings: readonly DigestFinding[];
  /** Literal strings allowed to contain digits in model text, longest first. */
  readonly allowedLiterals: readonly string[];
}

/** Builds the fact index from a digest. Pure; same digest ⇒ same index. */
export function buildFactIndex(digest: DigestBundle): FactIndex {
  const quantities = new Map(digest.quantities.map((quantity) => [quantity.id, quantity] as const));
  const anchors = new Map(
    digest.anchors.map(
      (anchor) =>
        [
          anchor.id,
          {
            id: anchor.id,
            ref: anchor.ref,
            file: anchor.file,
            lineStart: anchor.lineStart,
            lineEnd: anchor.lineEnd,
            kind: anchor.kind,
            snippet: anchor.snippet,
          },
        ] as const,
    ),
  );
  const literals = new Set<string>();
  const addLiteral = (value: string): void => {
    if (value !== "") literals.add(value);
  };
  for (const fact of digest.changeFacts) {
    addLiteral(fact.path);
    addLiteral(basename(fact.path));
    if (fact.kind === "table") {
      // Row keys are data identifiers (like file names) — digits inside them are legitimate text.
      for (const row of [...fact.rowsAdded, ...fact.rowsRemoved, ...fact.rowsChanged]) {
        addLiteral(row.key);
      }
    }
  }
  for (const anchor of digest.anchors) {
    addLiteral(anchor.id);
    addLiteral(anchor.file);
    addLiteral(basename(anchor.file));
  }
  for (const finding of digest.findings) {
    addLiteral(finding.ruleId);
    addLiteral(finding.id);
  }
  const allowedLiterals = [...literals].sort(
    (a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0),
  );
  return { quantities, anchors, engineFindings: digest.findings, allowedLiterals };
}

/** Outcome of rendering one statement's placeholders. */
export interface RenderedText {
  /** Statement with every resolvable placeholder replaced by its engine value. */
  readonly text: string;
  /** Fact ids that resolved (the numbers this statement actually cited). */
  readonly factIds: string[];
  /** Placeholder ids that do not exist in the fact store. */
  readonly unknownIds: string[];
}

/** Renders `{{f:<factId>}}` placeholders from the fact store; unknown ids are reported, kept raw. */
export function renderStatement(text: string, index: FactIndex): RenderedText {
  const factIds: string[] = [];
  const unknownIds: string[] = [];
  const rendered = text.replace(PLACEHOLDER_PATTERN, (_match, rawId: string) => {
    const id = rawId.trim();
    const quantity = index.quantities.get(id);
    if (quantity === undefined) {
      unknownIds.push(id);
      return `{{f:${id}}}`;
    }
    factIds.push(id);
    return quantity.value;
  });
  return { text: rendered, factIds, unknownIds };
}

/** Numeric value of a quantity, or `null` when the raw text is not a finite number. */
export function numericValueOf(quantity: DigestQuantity): number | null {
  const trimmed = quantity.value.trim();
  if (trimmed === "") return null;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
}

/** Verdict of evaluating one typed claim against the fact store. */
export type ClaimVerdict = "true" | "false" | "invalid";

/**
 * Evaluates a typed claim — engine arithmetic, never the model's word: `equals`/`differs`
 * between two numeric facts. Unknown ids or non-numeric facts come back `invalid`.
 */
export function evaluateClaim(claim: TypedClaim, index: FactIndex): ClaimVerdict {
  const subject = index.quantities.get(claim.subject);
  const object = index.quantities.get(claim.object);
  if (subject === undefined || object === undefined) return "invalid";
  const left = numericValueOf(subject);
  const right = numericValueOf(object);
  if (left === null || right === null) return "invalid";
  const equal = left === right;
  if (claim.relation === "equals") return equal ? "true" : "false";
  return equal ? "false" : "true";
}

/**
 * Finds digit runs in model text that no fact or allowed literal covers — the free-number scan.
 *
 * Masking is pure set arithmetic: placeholders first, then every allowed literal (file paths,
 * basenames, anchor ids, rule ids, plus caller-provided extras such as theme ids). Whatever
 * digits remain have no source in the digest and are rejected.
 */
export function findFreeNumbers(
  text: string,
  index: FactIndex,
  extraLiterals: readonly string[] = [],
): string[] {
  // Long quotes (≥8 chars) are verified against cited snippets separately — digits inside them
  // are justified by snippet text, so mask them before scanning.
  let masked = text.replace(PLACEHOLDER_PATTERN, "\u0000").replace(/"([^"]{8,})"/gu, "\u0000");
  const literals =
    extraLiterals.length === 0
      ? index.allowedLiterals
      : [...extraLiterals, ...index.allowedLiterals].sort(
          (a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0),
        );
  for (const literal of literals) {
    if (literal !== "" && masked.includes(literal)) masked = masked.split(literal).join("\u0000");
  }
  const violations: string[] = [];
  const pattern = /\d+(?:\.\d+)?/gu;
  let match: RegExpExecArray | null = pattern.exec(masked);
  while (match !== null) {
    violations.push(match[0]);
    match = pattern.exec(masked);
  }
  return violations;
}

/** Basename of a bundle-relative path (forward slashes). */
export function basename(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

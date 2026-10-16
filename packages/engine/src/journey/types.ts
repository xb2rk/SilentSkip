/**
 * Value Journey v1 — ordered propagation chains from a changed value.
 *
 * A journey answers "where does this value go?" with layered, clickable
 * structure: every node carries a file, a raw-faithful span, the confidence of
 * the step that reached it and a derivation chain. The default budget is two
 * layers beyond the origin (plan §4.3); callers may raise it, and truncation is
 * reported instead of hidden.
 *
 * Honesty rules:
 * - No relation → no node. Unresolved callees surface as `unknown` call-sites
 *   with an explicit derivation, never as resolved symbols.
 * - An empty journey is a statement, not a failure: the `note` says there is no
 *   code path (dead value) and suggests pinning a binding.
 */

import type { FactBundle, FactSpan } from "../facts/index.js";
import type { RelationConfidence, RelationSet } from "../relations/index.js";

/** Version of the journey JSON shape; bump when the structure changes. */
export const JOURNEY_SCHEMA_VERSION = 1;

/** Where a journey starts: a CSV table/row or a symbol inside the bundle. */
export type JourneyOrigin =
  | {
      readonly kind: "csv";
      /** Bundle-relative path of the CSV file (must match the relations context). */
      readonly path: string;
      /** Optional row key for labelling; row-level binding is E7/E8 work. */
      readonly rowKey?: string;
    }
  | {
      readonly kind: "symbol";
      /** File containing the symbol. */
      readonly file: string;
      /** Symbol id as produced by the facts layer. */
      readonly symbolId: string;
    };

/** Input for {@link buildJourney}. */
export interface JourneyInput {
  readonly bundle: FactBundle;
  readonly relations: RelationSet;
  readonly origin: JourneyOrigin;
  /** Layers expanded beyond the origin node; default 2. */
  readonly maxDepth?: number;
  /** Maximum kept nodes per layer; default 24. Overflow sets `truncated`. */
  readonly maxNodesPerLayer?: number;
}

/** One step of a journey. */
export interface JourneyNode {
  /** Deterministic id: `kind|file|offset|symbolId-or-label`. */
  readonly id: string;
  /** 0 = origin; 1.. = expansion layers. */
  readonly level: number;
  readonly kind: "csv-table" | "string-literal" | "symbol" | "ref-site" | "call-site";
  /** File of this node — the CSV path for `csv-table`. */
  readonly file: string;
  /** Raw-faithful span of this node; absent only for `csv-table`. */
  readonly span?: FactSpan;
  /** Human label: table path, literal text, symbol name, ref name or callee text. */
  readonly label: string;
  /** Symbol id when this node is (or points at) a symbol. */
  readonly symbolId?: string;
  /** Confidence of the step that reached this node; `origin` for level 0. */
  readonly confidence: RelationConfidence | "origin";
  /** Why this node is here — copied from the relation or structural fact. */
  readonly derivation: readonly string[];
}

/** One ordered path from the origin to a leaf. */
export interface JourneyChain {
  readonly nodes: readonly JourneyNode[];
}

/** The assembled journey. */
export interface Journey {
  readonly schemaVersion: typeof JOURNEY_SCHEMA_VERSION;
  readonly origin: JourneyNode;
  /** Deterministic order (depth-first over sorted children). */
  readonly chains: readonly JourneyChain[];
  /** True when a layer or the chain cap was hit. */
  readonly truncated: boolean;
  /** Present only when there are no chains — the honest "dead value" note. */
  readonly note?: string;
}

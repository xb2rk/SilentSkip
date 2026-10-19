import type { LinkStats } from "./types.js";

/** All-zero counters — the starting point of every link run. */
export function emptyLinkStats(): LinkStats {
  return {
    findingsChecked: 0,
    findingsStripped: 0,
    anchorsChecked: 0,
    anchorsStripped: 0,
    numbersChecked: 0,
    numbersUnverified: 0,
    quotesChecked: 0,
    quotesUnverified: 0,
    confidenceDowngraded: 0,
  };
}

/** Adds two counter sets (used to aggregate the per-unit read passes). */
export function addLinkStats(a: LinkStats, b: LinkStats): LinkStats {
  return {
    findingsChecked: a.findingsChecked + b.findingsChecked,
    findingsStripped: a.findingsStripped + b.findingsStripped,
    anchorsChecked: a.anchorsChecked + b.anchorsChecked,
    anchorsStripped: a.anchorsStripped + b.anchorsStripped,
    numbersChecked: a.numbersChecked + b.numbersChecked,
    numbersUnverified: a.numbersUnverified + b.numbersUnverified,
    quotesChecked: a.quotesChecked + b.quotesChecked,
    quotesUnverified: a.quotesUnverified + b.quotesUnverified,
    confidenceDowngraded: a.confidenceDowngraded + b.confidenceDowngraded,
  };
}

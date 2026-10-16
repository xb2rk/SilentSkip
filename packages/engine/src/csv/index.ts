/**
 * CSV subsystem — raw-faithful parsing with exact source coordinates.
 *
 * This is the only CSV reader in the project: every consumer (facts, deltas, tables UI)
 * goes through `parseCsv` so coordinate and raw-faithfulness guarantees hold everywhere.
 */

export * from "./parse.js";
export * from "./types.js";

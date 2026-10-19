import type { DigestUnit } from "@silentskip/contracts";

/**
 * Byte budget of one read call's material (compact entries + function bodies + anchor packs) — a
 * bound on the call payload, not a preference: units above it are read chunk by chunk (E7.5,
 * nothing dropped).
 *
 * Only the unit material is budgeted, so the payload a read call sends is roughly
 * `budget + ~105 KB` (skeleton of every changed file + facts + prompt + manifest). Insea carried
 * 419 KB and 390 KB payloads and rejected a merged chunk whose material alone was 146 KB (~480 KB
 * by that ratio; plan §7), so the sum has to stay well under ~400 KB. At 90_000 this 72-file digest
 * split three units, and three of the six chunk calls it produced cost 30-53 s for 4-33 KB of
 * material — a call has a floor, so splitting is the expensive way to stay small. At 200_000 every
 * unit of the digest goes in one call (largest material: 179 KB) and the payload stays ~285 KB.
 */
export const READ_CHUNK_BUDGET_BYTES = 200_000;

/** One attention slice of a reading unit — a chunk is one `read` call. */
export interface ReadChunk {
  readonly index: number;
  readonly files: readonly string[];
  readonly payload: string;
}

/**
 * Split a reading unit's material into read-call chunks of ~`budget` bytes. Files keep the unit's
 * order; a single oversized file goes into a chunk alone. The material stays lossless: chunks are
 * sequential read calls, not a sampling of the unit.
 *
 * The weight is what the call actually carries: the unit payload, the bodies and the anchor pack of
 * each file (the fixed skeleton/prompt overhead — ~105 KB — sits on top of the budget, see
 * `READ_CHUNK_BUDGET_BYTES`).
 */
export function chunkReadingUnit(
  unit: DigestUnit,
  bodyBytesByFile: ReadonlyMap<string, number>,
  budget: number,
  anchorBytesByFile: ReadonlyMap<string, number> = new Map(),
): ReadChunk[] {
  const entries = JSON.parse(unit.payload) as { path?: unknown }[];
  const byPath = new Map<string, unknown[]>();
  const order: string[] = [];
  for (const entry of entries) {
    const path = typeof entry.path === "string" ? entry.path : "";
    const list = byPath.get(path);
    if (list === undefined) {
      byPath.set(path, [entry]);
      order.push(path);
    } else {
      list.push(entry);
    }
  }
  if (order.length <= 1) {
    return [{ index: 0, files: [...unit.files], payload: unit.payload }];
  }
  const weightOf = (path: string): number =>
    Buffer.byteLength(JSON.stringify(byPath.get(path) ?? []), "utf8") +
    (bodyBytesByFile.get(path) ?? 0) +
    (anchorBytesByFile.get(path) ?? 0);
  const serialize = (files: readonly string[]): string =>
    JSON.stringify(files.flatMap((file) => byPath.get(file) ?? []));
  const chunks: ReadChunk[] = [];
  let current: string[] = [];
  let currentBytes = 0;
  for (const path of order) {
    const weight = weightOf(path);
    if (current.length > 0 && currentBytes + weight > budget) {
      chunks.push({ index: chunks.length, files: current, payload: serialize(current) });
      current = [];
      currentBytes = 0;
    }
    current.push(path);
    currentBytes += weight;
  }
  if (current.length > 0) {
    chunks.push({ index: chunks.length, files: current, payload: serialize(current) });
  }
  return chunks;
}

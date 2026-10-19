import type { DigestUnit } from "@silentskip/contracts";

/**
 * Byte budget of one read call's material (compact entries + function bodies + anchor packs) — a
 * bound on the call payload, not a preference: units above it are read chunk by chunk (E7.5,
 * nothing dropped).
 *
 * Only the unit material is budgeted, so the payload a read call sends is roughly
 * `budget + ~105 KB` (skeleton of every changed file + facts + prompt + manifest). Measurements on
 * the 78-file digest (2026-10-20, `AI_READ_CONCURRENCY=1`):
 * - budget 200_000 with anchor packs counted: 9 chunked read calls, 13m54s total, 1m33s average,
 *   payloads ~225 KB average. The 515 KB payloads of the un-counted run were accepted, so smaller
 *   calls bought no timeout safety — they only paid the per-call floor more often.
 * - uncapped (anchors not counted): 5 calls, 8m53s, largest payload 515 KB (accepted).
 * 400_000 keeps pathological payloads in check (worst observed material 401 KB stays one chunk per
 * unit unless a unit genuinely exceeds it) while not splitting units whose calls Insea already
 * carries fine.
 */
export const READ_CHUNK_BUDGET_BYTES = 400_000;

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

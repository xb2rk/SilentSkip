import {
  type DigestFinding,
  type ReviewCompareResponse,
  ReviewCompareResponseSchema,
  type RunDetailResponse,
  type SilentSkipEntry,
  type SilentSkipSurface,
  type SurfaceHistoryResponse,
  SurfaceHistoryResponseSchema,
} from "@craftland-qa/contracts";
import type { AppDatabase } from "@craftland-qa/db";
import { runs } from "@craftland-qa/db";
import { desc, eq } from "drizzle-orm";

/**
 * History compare (E9.4) - deterministic diffs between two stored runs.
 *
 * Only persisted exact data is compared: engine finding ids and silent-skip surface entries.
 * AI prose counts are reported but never set-compared. Legacy runs (no `engineFindings`) are
 * flagged as unavailable instead of being treated as "empty", so the UI can stay honest.
 */

const MAX_HISTORY_ENTRIES = 20;

function sideOf(run: RunDetailResponse): ReviewCompareResponse["left"] {
  const result = run.result;
  return {
    runId: run.id,
    projectId: run.projectId,
    status: run.status,
    verdict: run.verdict,
    qualityScore: run.qualityScore,
    createdAt: run.createdAt,
    durationMs: run.durationMs,
    findingsCount: result?.report.findings.length ?? 0,
    themesCount: result?.themes.length ?? 0,
    unknownsCount: result?.report.unknowns.length ?? 0,
    engineFindingsAvailable:
      result?.engineFindings !== null && result?.engineFindings !== undefined,
    surfacesAvailable: result?.surfaces !== null && result?.surfaces !== undefined,
  };
}

/** Union of both runs' surface entries, keyed by the content-stable entry id. */
function surfaceEntryMap(surface: SilentSkipSurface | null): Map<string, SilentSkipEntry> {
  const map = new Map<string, SilentSkipEntry>();
  if (surface === null) {
    return map;
  }
  for (const entry of [...surface.base.entries, ...surface.current.entries]) {
    map.set(entry.id, entry);
  }
  return map;
}

function compareEngineFindings(
  left: readonly DigestFinding[] | null,
  right: readonly DigestFinding[] | null,
): ReviewCompareResponse["engineFindings"] {
  const ids = new Set<string>();
  const leftById = new Map<string, DigestFinding>();
  const rightById = new Map<string, DigestFinding>();
  for (const finding of left ?? []) {
    ids.add(finding.id);
    leftById.set(finding.id, finding);
  }
  for (const finding of right ?? []) {
    ids.add(finding.id);
    rightById.set(finding.id, finding);
  }
  return [...ids].sort().map((id) => {
    const sample = leftById.get(id) ?? rightById.get(id);
    return {
      id,
      ruleId: sample?.ruleId ?? "",
      severity: sample?.severity ?? "info",
      title: sample?.title ?? "",
      inLeft: leftById.has(id),
      inRight: rightById.has(id),
    };
  });
}

function compareSurfaces(
  left: SilentSkipSurface | null,
  right: SilentSkipSurface | null,
): ReviewCompareResponse["surfaces"] {
  const leftMap = surfaceEntryMap(left);
  const rightMap = surfaceEntryMap(right);
  const ids = new Set([...leftMap.keys(), ...rightMap.keys()]);
  return [...ids].sort().map((id) => {
    const sample = leftMap.get(id) ?? rightMap.get(id);
    return {
      id,
      table: sample?.table ?? "",
      rowKey: sample?.rowKey ?? "",
      column: sample?.column ?? null,
      mechanism: sample?.mechanism ?? "",
      effect: sample?.effect ?? "",
      inLeft: leftMap.has(id),
      inRight: rightMap.has(id),
    };
  });
}

/** Compare two stored runs; both must have a persisted result. */
export function compareRuns(
  left: RunDetailResponse,
  right: RunDetailResponse,
): ReviewCompareResponse {
  const leftResult = left.result;
  const rightResult = right.result;
  const leftSide = sideOf(left);
  const rightSide = sideOf(right);
  const legacy = !leftSide.engineFindingsAvailable || !rightSide.engineFindingsAvailable;
  const engineFindings = compareEngineFindings(
    leftResult?.engineFindings ?? null,
    rightResult?.engineFindings ?? null,
  );
  const surfaces = compareSurfaces(leftResult?.surfaces ?? null, rightResult?.surfaces ?? null);
  return ReviewCompareResponseSchema.parse({
    left: leftSide,
    right: rightSide,
    engineFindings,
    surfaces,
    note: legacy
      ? "Một trong hai lượt chạy không có dữ liệu engine (chạy trước E9) - phần đối chiếu engine chỉ hiển thị những gì đã lưu, không suy diễn."
      : "Đối chiếu chỉ dùng dữ liệu tất định đã lưu (engine findings + silent-skip). Không so sánh văn bản AI theo tập hợp.",
  });
}

/** Silent-skip counts per recent completed run of one project (History chart, E9.4). */
export function surfaceHistory(
  db: AppDatabase,
  projectId: string,
  limit = MAX_HISTORY_ENTRIES,
): SurfaceHistoryResponse {
  const capped = Math.min(Math.max(limit, 1), 50);
  const rows = db
    .select({
      id: runs.id,
      createdAt: runs.createdAt,
      verdict: runs.verdict,
      score: runs.qualityScore,
      reportJson: runs.reportJson,
    })
    .from(runs)
    .where(eq(runs.projectId, projectId))
    .orderBy(desc(runs.createdAt))
    .limit(capped * 2)
    .all();
  const entries: SurfaceHistoryResponse["entries"] = [];
  let skippedLegacy = 0;
  for (const row of rows) {
    if (entries.length >= capped) {
      break;
    }
    if (row.reportJson === null) {
      skippedLegacy += 1;
      continue;
    }
    let surface: SilentSkipSurface | null = null;
    try {
      const parsed = JSON.parse(row.reportJson) as { surfaces?: SilentSkipSurface | null };
      surface = parsed.surfaces ?? null;
    } catch {
      surface = null;
    }
    if (surface === null) {
      skippedLegacy += 1;
      continue;
    }
    entries.push({
      runId: row.id,
      createdAt: row.createdAt.toISOString(),
      verdict: row.verdict,
      qualityScore: row.score,
      newSilent: surface.delta.newSilent.length,
      fixed: surface.delta.fixed.length,
      unchanged: surface.delta.unchanged.length,
      detectedMechanisms: [...surface.detectedMechanisms],
    });
  }
  return SurfaceHistoryResponseSchema.parse({
    entries,
    skippedLegacy,
    note:
      skippedLegacy > 0
        ? `${skippedLegacy} lượt chạy cũ không có dữ liệu silent-skip nên không được vẽ.`
        : "Mọi lượt chạy gần đây đều có dữ liệu silent-skip.",
  });
}

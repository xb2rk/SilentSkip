import type { LocalizationReport } from "@silentskip/contracts";
import { AppError, type DigestBundle, ErrorCodes, WORKTREE_REF } from "@silentskip/contracts";
import { buildDigest, buildLocalizationReport } from "@silentskip/engine";
import { readFilesAtRef, readProjectFilesFromDisk, resolveCommit } from "./git";

interface ResolvedSources {
  readonly baseCommit: string;
  readonly currentCommit: string | null;
  readonly baseSources: Awaited<ReturnType<typeof readFilesAtRef>>;
  readonly currentSources: Awaited<ReturnType<typeof readFilesAtRef>>;
}

/**
 * Resolve an A/B range and read both source sets once - shared by the digest, localization
 * report and review manager so every path sees the same refs, ignored files and line endings.
 */
async function loadSideSources(
  rootPath: string,
  base: string,
  current: string,
): Promise<ResolvedSources> {
  if (base === WORKTREE_REF) {
    throw new AppError(
      ErrorCodes.badRequest,
      "Bản gốc (A) phải là ref thật — không thể là bản đang làm",
    );
  }
  const baseCommit = await resolveCommit(rootPath, base);
  const currentIsWorktree = current === WORKTREE_REF;
  const currentCommit = currentIsWorktree ? null : await resolveCommit(rootPath, current);
  const [baseSources, currentSources] = await Promise.all([
    readFilesAtRef(rootPath, base),
    currentIsWorktree
      ? Promise.resolve(readProjectFilesFromDisk(rootPath))
      : readFilesAtRef(rootPath, current),
  ]);
  return { baseCommit, currentCommit, baseSources, currentSources };
}

/**
 * Load the digest inputs for an A/B range (E3.3) - shared by the digest route and the review
 * manager so both paths resolve refs and read sources identically.
 *
 * `base` must be a real ref (WORKTREE is only meaningful as the current side); the worktree
 * side is read from disk, everything else via one `cat-file --batch` pass. The project profile
 * (pins, conventions, entity notes) is passed through as data - the digest stays deterministic.
 */
export async function loadDigest(
  rootPath: string,
  base: string,
  current: string,
  profile?: Parameters<typeof buildDigest>[0]["profile"],
): Promise<DigestBundle> {
  const { baseCommit, currentCommit, baseSources, currentSources } = await loadSideSources(
    rootPath,
    base,
    current,
  );
  return buildDigest({
    base: { ref: base, commitHash: baseCommit, sources: baseSources },
    current: { ref: current, commitHash: currentCommit, sources: currentSources },
    ...(profile === undefined ? {} : { profile }),
  });
}

/**
 * Build the deterministic LOC-01 localization report for an A/B range. No AI, no profile
 * table list: tables are discovered from `*key.csv` names plus their language header.
 */
export async function loadLocalizationReport(
  rootPath: string,
  base: string,
  current: string,
): Promise<LocalizationReport> {
  const { baseSources, currentSources } = await loadSideSources(rootPath, base, current);
  return buildLocalizationReport({
    base: { ref: "A", label: base, sources: baseSources },
    current: { ref: "B", label: current, sources: currentSources },
  });
}

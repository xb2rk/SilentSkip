import { AppError, type DigestBundle, ErrorCodes, WORKTREE_REF } from "@craftland-qa/contracts";
import { buildDigest } from "@craftland-qa/engine";
import { readFilesAtRef, readProjectFilesFromDisk, resolveCommit } from "./git";

/**
 * Load the digest inputs for an A/B range (E3.3) — shared by the digest route and the review
 * manager so both paths resolve refs and read sources identically.
 *
 * `base` must be a real ref (WORKTREE is only meaningful as the current side); the worktree
 * side is read from disk, everything else via one `cat-file --batch` pass. The project profile
 * (pins, conventions, entity notes) is passed through as data — the digest stays deterministic.
 */
export async function loadDigest(
  rootPath: string,
  base: string,
  current: string,
  profile?: Parameters<typeof buildDigest>[0]["profile"],
): Promise<DigestBundle> {
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
  return buildDigest({
    base: { ref: base, commitHash: baseCommit, sources: baseSources },
    current: { ref: current, commitHash: currentCommit, sources: currentSources },
    ...(profile === undefined ? {} : { profile }),
  });
}

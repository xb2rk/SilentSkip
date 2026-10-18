import { execFile, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  AppError,
  type DiffFileEntry,
  type DiffFileKind,
  type DiffFileStatus,
  type DiffSummary,
  ErrorCodes,
  type GitHead,
  type GitRef,
  type GitRefKind,
  type ProjectRefsResponse,
  WORKTREE_REF,
} from "@craftland-qa/contracts";
import type { SourceInput } from "@craftland-qa/engine";

/**
 * Read-only git access (E1) plus source content readers (E3): all FC/CSV files at a ref
 * via one `cat-file --batch` pass, and the same set from disk for the worktree side.
 *
 * Invariants:
 * - `execFile` with array arguments only — never a shell; nothing here can mutate a repo.
 * - Refs are resolved (`rev-parse --verify <ref>^{commit}`) before being used in diff calls,
 *   so a ref string can never reach git as an option.
 * - `core.quotepath=false` keeps non-ASCII paths readable in output.
 */

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 20_000;
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

async function runGit(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-c", "core.quotepath=false", ...args], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      windowsHide: true,
      encoding: "utf8",
    });
    return stdout;
  } catch (error) {
    throw mapGitError(error, args);
  }
}

function mapGitError(error: unknown, args: readonly string[]): AppError {
  const candidate = error as { stderr?: unknown };
  const stderr = typeof candidate.stderr === "string" ? candidate.stderr : "";
  if (/not a git repository/i.test(stderr)) {
    return new AppError(ErrorCodes.notAGitRepo, "Thư mục không phải git repository", {
      cause: error,
    });
  }
  return new AppError(ErrorCodes.gitFailed, `git ${args[0] ?? ""} thất bại`, {
    cause: error,
    details: stderr.trim().slice(0, 2000),
  });
}

const KIND_ORDER: Record<GitRefKind, number> = { branch: 0, remote: 1, tag: 2 };

/** Current branch (null when detached) + HEAD commit; `null` for a repository without commits. */
export async function getHead(rootPath: string): Promise<GitHead | null> {
  let logRaw: string;
  try {
    logRaw = await runGit(rootPath, ["log", "-1", "--format=%H%x00%cI%x00%s"]);
  } catch (error) {
    if (error instanceof AppError && error.code === ErrorCodes.notAGitRepo) throw error;
    return null; // unborn branch — repository exists but has no commits yet
  }
  const branchRaw = (await runGit(rootPath, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  const [commitHash = "", , subject = ""] = logRaw.trim().split("\x00");
  return { branch: branchRaw === "HEAD" ? null : branchRaw, commitHash, subject };
}

/** All local branches, remotes and tags, with the commit each currently points at. */
export async function listRefs(rootPath: string): Promise<GitRef[]> {
  const format =
    "%(refname)%09%(refname:short)%09%(objectname)%09%(creatordate:iso-strict)%09%(subject)";
  const raw = await runGit(rootPath, [
    "for-each-ref",
    `--format=${format}`,
    "refs/heads",
    "refs/remotes",
    "refs/tags",
  ]);
  const refs: GitRef[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    const [full = "", name = "", commitHash = "", committedAt = "", ...subjectParts] =
      line.split("\t");
    if (full === "" || name === "" || commitHash === "" || full.endsWith("/HEAD")) continue;
    const kind: GitRefKind = full.startsWith("refs/tags/")
      ? "tag"
      : full.startsWith("refs/remotes/")
        ? "remote"
        : "branch";
    refs.push({
      name,
      kind,
      commitHash,
      subject: subjectParts.join("\t"),
      committedAt: committedAt === "" ? null : committedAt,
    });
  }
  return refs.sort(
    (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name),
  );
}

/** Head, dirty flag and refs in one call — the payload the A/B picker reads. */
export async function projectRefs(rootPath: string): Promise<ProjectRefsResponse> {
  const head = await getHead(rootPath);
  const dirty = (await runGit(rootPath, ["status", "--porcelain"])).trim().length > 0;
  const refs = head === null ? [] : await listRefs(rootPath);
  return { head, dirty, refs };
}

/** Resolve a ref to a commit hash. Throws UNKNOWN_REF when it does not resolve. */
export async function resolveCommit(rootPath: string, ref: string): Promise<string> {
  if (ref === "" || ref.startsWith("-")) {
    throw new AppError(ErrorCodes.unknownRef, `Ref không hợp lệ: ${ref}`);
  }
  try {
    return (await runGit(rootPath, ["rev-parse", "--verify", `${ref}^{commit}`])).trim();
  } catch (error) {
    if (error instanceof AppError && error.code === ErrorCodes.notAGitRepo) throw error;
    throw new AppError(ErrorCodes.unknownRef, `Không tìm thấy ref: ${ref}`, { cause: error });
  }
}

interface ParsedStatus {
  readonly status: DiffFileStatus;
  readonly oldPath: string | null;
}

/**
 * A/B file-level diff summary with per-file line counts — the preview designers see before
 * running an analysis. `currentRef = WORKTREE_REF` diffs against the files on disk
 * (untracked files included, reported with status `U`).
 */
export async function diffSummary(
  rootPath: string,
  baseRef: string,
  currentRef: string,
): Promise<DiffSummary> {
  if (baseRef === WORKTREE_REF) {
    throw new AppError(
      ErrorCodes.badRequest,
      "Bản gốc (A) phải là ref thật — không thể là bản đang làm",
    );
  }
  const baseCommit = await resolveCommit(rootPath, baseRef);
  const currentIsWorktree = currentRef === WORKTREE_REF;
  const currentCommit = currentIsWorktree ? null : await resolveCommit(rootPath, currentRef);
  const revArgs = currentCommit === null ? [baseCommit] : [baseCommit, currentCommit];

  const [nameStatusRaw, numstatRaw, untrackedRaw] = await Promise.all([
    runGit(rootPath, ["diff", "--name-status", "-M", ...revArgs]),
    runGit(rootPath, ["diff", "--numstat", "-M", ...revArgs]),
    currentIsWorktree
      ? runGit(rootPath, ["ls-files", "--others", "--exclude-standard"])
      : Promise.resolve(""),
  ]);

  const statuses = parseNameStatus(nameStatusRaw);
  const counts = parseNumstat(numstatRaw);

  const entries: DiffFileEntry[] = [];
  for (const [path, status] of statuses) {
    const count = counts.get(path);
    entries.push({
      path,
      oldPath: status.oldPath,
      status: status.status,
      kind: classifyKind(path),
      additions: count?.additions ?? null,
      deletions: count?.deletions ?? null,
    });
  }
  const untrackedFiles = untrackedRaw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  for (const path of untrackedFiles) {
    entries.push({
      path,
      oldPath: null,
      status: "U",
      kind: classifyKind(path),
      additions: null,
      deletions: null,
    });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));

  let additions = 0;
  let deletions = 0;
  let csvFiles = 0;
  let scriptFiles = 0;
  for (const entry of entries) {
    additions += entry.additions ?? 0;
    deletions += entry.deletions ?? 0;
    if (entry.kind === "csv") csvFiles += 1;
    if (entry.kind === "script") scriptFiles += 1;
  }

  return {
    baseRef,
    currentRef,
    baseCommit,
    currentCommit,
    filesChanged: entries.length,
    additions,
    deletions,
    untrackedFiles: untrackedFiles.length,
    csvFiles,
    scriptFiles,
    files: entries,
  };
}

/**
 * Parse `--name-status` output into newPath → status. Copies (`C`) are reported as renames:
 * the preview only needs "this file appears under a new path" for both cases.
 */
function parseNameStatus(raw: string): Map<string, ParsedStatus> {
  const result = new Map<string, ParsedStatus>();
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    const parts = line.split("\t");
    const code = parts[0] ?? "";
    const flag = code.charAt(0);
    if (flag === "R" || flag === "C") {
      const oldPath = parts[1] ?? "";
      const newPath = parts[2] ?? "";
      if (newPath !== "") {
        result.set(newPath, { status: "R", oldPath: oldPath === "" ? null : oldPath });
      }
      continue;
    }
    const path = parts[1] ?? "";
    if (path === "") continue;
    const status: DiffFileStatus = flag === "A" ? "A" : flag === "D" ? "D" : "M";
    result.set(path, { status, oldPath: null });
  }
  return result;
}

function parseNumstat(
  raw: string,
): Map<string, { additions: number | null; deletions: number | null }> {
  const result = new Map<string, { additions: number | null; deletions: number | null }>();
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    const parts = line.split("\t");
    const additionsRaw = parts[0] ?? "";
    const deletionsRaw = parts[1] ?? "";
    const rawPath = parts.slice(2).join("\t");
    if (rawPath === "") continue;
    result.set(resolveNumstatPath(rawPath), {
      additions: toLineCount(additionsRaw),
      deletions: toLineCount(deletionsRaw),
    });
  }
  return result;
}

/** numstat prints `-` for binary files; anything non-finite degrades to `null` (unknown). */
function toLineCount(raw: string): number | null {
  if (raw === "-") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** numstat compacts rename paths as `old => new` or `dir/{old => new}.ext` — recover the new path. */
function resolveNumstatPath(raw: string): string {
  const braced = raw.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (braced !== null) {
    const [, prefix = "", , after = "", suffix = ""] = braced;
    return `${prefix}${after}${suffix}`;
  }
  const arrow = raw.lastIndexOf(" => ");
  return arrow === -1 ? raw : raw.slice(arrow + 4);
}

function classifyKind(path: string): DiffFileKind {
  const lower = path.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) return "csv";
  if (lower.endsWith(".fcc") || lower.endsWith(".fcg")) return "script";
  return "other";
}

const SOURCE_EXTENSIONS = /\.(fcc|fcg|csv|tsv)$/iu;

/**
 * Canonical text form for comparisons: LF line endings only.
 *
 * Git stores text with LF and `core.autocrlf` checks it out as CRLF on Windows. Without
 * canonicalization an unchanged file would look fully rewritten between the committed
 * blob and the working tree. Line endings are not game logic, and anchors stay line-based.
 */
function canonicalSource(source: string): string {
  return source.includes("\r\n") ? source.replace(/\r\n/g, "\n") : source;
}

/**
 * Read every FC/CSV source file at a ref in one `cat-file --batch` pass.
 *
 * Paths come from `ls-tree -r -z` (raw, unquoted); contents are decoded as UTF-8 text and
 * returned sorted by path for deterministic downstream bundles.
 */
export async function readFilesAtRef(rootPath: string, ref: string): Promise<SourceInput[]> {
  const listed = await runGit(rootPath, ["ls-tree", "-r", "-z", "--name-only", ref]);
  const paths = listed
    .split("\0")
    .filter((path) => path !== "" && SOURCE_EXTENSIONS.test(path))
    .sort();
  if (paths.length === 0) return [];

  const input = `${paths.map((path) => `${ref}:${path}`).join("\n")}\n`;
  const result = spawnSync("git", ["-C", rootPath, "cat-file", "--batch"], {
    input,
    maxBuffer: GIT_MAX_BUFFER,
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new AppError(ErrorCodes.gitFailed, "git cat-file thất bại", {
      cause: result.error,
      details: result.stderr.toString("utf8").trim().slice(0, 2000),
    });
  }

  const buffer = result.stdout;
  const files: SourceInput[] = [];
  let offset = 0;
  let index = 0;
  while (offset < buffer.length && index < paths.length) {
    const newline = buffer.indexOf(0x0a, offset);
    if (newline === -1) break;
    const header = buffer.subarray(offset, newline).toString("utf8");
    const path = paths[index];
    if (path === undefined) break;
    if (header.endsWith(" missing")) {
      offset = newline + 1;
      index += 1;
      continue;
    }
    const sizeRaw = header.split(" ")[2];
    const size = sizeRaw === undefined ? Number.NaN : Number(sizeRaw);
    if (!Number.isFinite(size)) break;
    const contentStart = newline + 1;
    files.push({
      path,
      source: canonicalSource(buffer.subarray(contentStart, contentStart + size).toString("utf8")),
    });
    offset = contentStart + size + 1; // skip the trailing newline after the content
    index += 1;
  }
  return files;
}

/**
 * Read every FC/CSV source file from disk — the worktree side of a comparison.
 *
 * Git decides the file set: tracked files plus untracked files that are not ignored
 * (`git ls-files --cached --others --exclude-standard`). Build artifacts, logs and
 * engine caches that the project's own `.gitignore` excludes must not enter the digest.
 * Paths are project-relative with forward slashes, sorted for deterministic bundles.
 */
export function readProjectFilesFromDisk(rootPath: string): SourceInput[] {
  const result = spawnSync(
    "git",
    ["-C", rootPath, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { maxBuffer: GIT_MAX_BUFFER, timeout: GIT_TIMEOUT_MS, windowsHide: true },
  );
  if (result.error !== undefined || result.status !== 0) {
    throw new AppError(ErrorCodes.gitFailed, "git ls-files thất bại", {
      cause: result.error,
      details: result.stderr.toString("utf8").trim().slice(0, 2000),
    });
  }
  const paths = [
    ...new Set(
      result.stdout
        .toString("utf8")
        .split("\0")
        .filter((path) => path !== "" && SOURCE_EXTENSIONS.test(path)),
    ),
  ].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const files: SourceInput[] = [];
  for (const path of paths) {
    try {
      const absolute = join(rootPath, ...path.split("/"));
      files.push({ path, source: canonicalSource(readFileSync(absolute, "utf8")) });
    } catch {
      // Deleted tracked files have no worktree content; the A/B delta reports the removal.
    }
  }
  return files;
}

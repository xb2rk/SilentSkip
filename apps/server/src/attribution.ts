import {
  AppError,
  ATTRIBUTION_SCHEMA_VERSION,
  type AttributionCommit,
  type AttributionResponse,
  type BlameLine,
  type BlameResponse,
  ErrorCodes,
  WORKTREE_REF,
} from "@craftland-qa/contracts";
import { resolveCommit, runGit } from "./git";

/**
 * Attribution (E9.3) - read-only git facts behind "who changed this?".
 *
 * `fileAttribution` lists the commits in `base..current` touching each changed file; when the
 * current side is the working tree the range stops at `HEAD` and touched-by-worktree files are
 * flagged instead of guessed. `blameLines` maps individual lines to the commit that last wrote
 * them; lines not committed yet are labelled honestly (`uncommitted: true`). Nothing here infers
 * intent or maps a finding to a person: it is a projection of git metadata.
 */

const MAX_COMMITS_PER_FILE = 10;
const MAX_BLAME_LINES = 400;

interface RawCommitRecord {
  readonly commit: string;
  readonly short: string;
  readonly author: string;
  readonly email: string;
  readonly date: string;
  readonly subject: string;
  readonly files: readonly string[];
}

function parseLog(raw: string): RawCommitRecord[] {
  const records: RawCommitRecord[] = [];
  for (const chunk of raw.split("\u001e")) {
    const text = chunk.trim();
    if (text === "") continue;
    const [header = "", ...fileLines] = text.split("\n");
    const [commit, short, author, email, date, subject] = header.split("\u001f");
    if (
      commit === undefined ||
      short === undefined ||
      author === undefined ||
      email === undefined ||
      date === undefined ||
      subject === undefined
    ) {
      continue;
    }
    records.push({
      commit,
      short,
      author,
      email,
      date,
      subject,
      files: fileLines.map((line) => line.trim()).filter((line) => line !== ""),
    });
  }
  return records;
}

function toAttributionCommit(record: RawCommitRecord): AttributionCommit {
  return {
    commit: record.commit,
    short: record.short,
    author: record.author,
    email: record.email,
    date: record.date,
    subject: record.subject,
  };
}

/** Commits touching each changed file in `base..current` plus a worktree flag on the disk side. */
export async function fileAttribution(
  rootPath: string,
  base: string,
  current: string,
): Promise<AttributionResponse> {
  if (base === WORKTREE_REF) {
    throw new AppError(
      ErrorCodes.badRequest,
      "Bản gốc (A) phải là ref thật — không thể là bản đang làm",
    );
  }
  const baseCommit = await resolveCommit(rootPath, base);
  const currentIsWorktree = current === WORKTREE_REF;
  const currentCommit = currentIsWorktree ? null : await resolveCommit(rootPath, current);
  const range = `${baseCommit}..${currentIsWorktree ? "HEAD" : currentCommit}`;
  const raw = await runGit(rootPath, [
    "log",
    "--format=%x1e%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s",
    "--name-only",
    range,
  ]);

  const commitsByFile = new Map<string, RawCommitRecord[]>();
  for (const record of parseLog(raw)) {
    for (const file of record.files) {
      const list = commitsByFile.get(file) ?? [];
      list.push(record);
      commitsByFile.set(file, list);
    }
  }

  const worktreeTouched = new Set<string>();
  if (currentIsWorktree) {
    const status = await runGit(rootPath, ["status", "--porcelain", "-z"]);
    for (const entry of status.split("\u0000")) {
      if (entry.length < 4) continue;
      const path = entry.slice(3).trim();
      if (path !== "") worktreeTouched.add(path);
    }
  }

  const files = [...new Set([...commitsByFile.keys(), ...worktreeTouched])].sort((a, b) =>
    a.localeCompare(b),
  );

  return {
    schemaVersion: ATTRIBUTION_SCHEMA_VERSION,
    base,
    current,
    note: currentIsWorktree
      ? "Commits cover base..HEAD; files touched by the working tree are flagged separately."
      : "Commits cover the full base..current range.",
    files: files.map((path) => {
      const commits = commitsByFile.get(path) ?? [];
      return {
        path,
        commitCount: commits.length,
        truncated: commits.length > MAX_COMMITS_PER_FILE,
        changedInWorktree: worktreeTouched.has(path),
        commits: commits.slice(0, MAX_COMMITS_PER_FILE).map(toAttributionCommit),
      };
    }),
  };
}

function assertRepoFile(file: string): void {
  if (
    file === "" ||
    file.startsWith("/") ||
    file.includes("\\") ||
    file.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new AppError(ErrorCodes.badRequest, "Đường dẫn file không hợp lệ");
  }
}

/** Blame a line range; `rev` null means the working tree. */
export async function blameLines(
  rootPath: string,
  rev: string | null,
  file: string,
  startLine: number,
  endLine: number,
): Promise<BlameResponse> {
  assertRepoFile(file);
  if (startLine < 1 || endLine < startLine || endLine - startLine + 1 > MAX_BLAME_LINES) {
    throw new AppError(ErrorCodes.badRequest, "Khoảng dòng không hợp lệ");
  }
  const commit = rev === null || rev === WORKTREE_REF ? null : await resolveCommit(rootPath, rev);
  const args = [
    "blame",
    "--line-porcelain",
    ...(commit === null ? [] : [commit]),
    "-L",
    `${startLine},${endLine}`,
    "--",
    file,
  ];
  const raw = await runGit(rootPath, args);

  const lines: BlameLine[] = [];
  let current: { commit: string; line: number } | null = null;
  let author = "";
  let epoch = 0;
  let subject = "";

  const flush = (): void => {
    if (current === null) return;
    const uncommitted = /^0+$/.test(current.commit);
    lines.push({
      line: current.line,
      commit: uncommitted ? "" : current.commit,
      short: uncommitted ? "" : current.commit.slice(0, 7),
      author: uncommitted ? "chưa commit" : author,
      date: epoch === 0 ? "" : new Date(epoch * 1000).toISOString(),
      subject: uncommitted ? "" : subject,
      uncommitted,
    });
    current = null;
  };

  for (const line of raw.split("\n")) {
    if (line === "") continue;
    const header = /^([0-9a-f^]{7,40})\s+\d+\s+(\d+)(?:\s+\d+)?$/.exec(line);
    if (header?.[1] !== undefined && header[2] !== undefined) {
      flush();
      current = { commit: header[1], line: Number.parseInt(header[2], 10) };
      author = "";
      epoch = 0;
      subject = "";
      continue;
    }
    if (line.startsWith("author ")) author = line.slice(7);
    else if (line.startsWith("author-time ")) epoch = Number.parseInt(line.slice(12), 10) || 0;
    else if (line.startsWith("summary ")) subject = line.slice(8);
  }
  flush();

  return {
    schemaVersion: ATTRIBUTION_SCHEMA_VERSION,
    file,
    startLine,
    endLine,
    lines,
    note:
      commit === null
        ? "Blame of the working tree; lines not committed yet are labelled."
        : "Blame at the resolved current commit.",
  };
}

/** Author label used by the API note; exported for tests that want to prefix emails. */
export function authorLabel(author: string, email: string): string {
  return email === "" ? author : `${author} <${email}>`;
}

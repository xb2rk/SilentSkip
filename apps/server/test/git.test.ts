import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppError, ErrorCodes, WORKTREE_REF } from "@silentskip/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  diffSummary,
  getHead,
  projectRefs,
  readFilesAtRef,
  readProjectFilesFromDisk,
  resolveCommit,
} from "../src/git";

/**
 * Integration tests against a real temporary git repository. Git is a hard requirement of the
 * product, so these tests exercise the actual binary (no mocks) — the same thing users run.
 */

function git(cwd: string, args: readonly string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "core.quotepath=false",
      ...args,
    ],
    { cwd, encoding: "utf8" },
  );
}

let repo: string;
let firstCommit: string;
let emptyRepo: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "cqa-git-"));
  git(repo, ["init"]);
  mkdirSync(join(repo, "Assets", "CSV"), { recursive: true });
  mkdirSync(join(repo, "Assets", "Scripts"), { recursive: true });
  writeFileSync(join(repo, "Assets", "CSV", "Sample.csv"), "id,value\n1,2\n");
  writeFileSync(join(repo, "Assets", "Scripts", "Old.fcg"), "static graph Old\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "initial"]);
  firstCommit = git(repo, ["rev-parse", "HEAD"]).trim();

  git(repo, ["checkout", "-b", "feature"]);
  writeFileSync(join(repo, "Assets", "CSV", "Sample.csv"), "id,value\n1,3\n2,4\n");
  git(repo, ["mv", "Assets/Scripts/Old.fcg", "Assets/Scripts/Renamed.fcg"]);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "feature changes"]);
  writeFileSync(join(repo, "Assets", "CSV", "New.csv"), "x\n");
  writeFileSync(join(repo, "Assets", "Scripts", "Fresh.fcg"), "static graph F\n");

  emptyRepo = mkdtempSync(join(tmpdir(), "cqa-git-empty-"));
  git(emptyRepo, ["init"]);
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
  rmSync(emptyRepo, { recursive: true, force: true });
});

describe("git read layer", () => {
  it("reports head, refs and dirty state", async () => {
    const refs = await projectRefs(repo);
    expect(refs.head?.branch).toBe("feature");
    expect(refs.head?.subject).toBe("feature changes");
    expect(refs.dirty).toBe(true);
    expect(refs.refs.some((ref) => ref.name === "feature" && ref.kind === "branch")).toBe(true);
    expect((await getHead(repo))?.commitHash).toHaveLength(40);
  });

  it("summarizes a committed A/B diff with per-file counts and kinds", async () => {
    const summary = await diffSummary(repo, firstCommit, "feature");
    expect(summary.baseCommit).toBe(firstCommit);
    expect(summary.filesChanged).toBe(2);
    expect(summary.csvFiles).toBe(1);
    expect(summary.scriptFiles).toBe(1);
    const csv = summary.files.find((file) => file.path === "Assets/CSV/Sample.csv");
    expect(csv?.status).toBe("M");
    expect(csv?.additions).toBe(2);
    expect(csv?.deletions).toBe(1);
    const renamed = summary.files.find((file) => file.path === "Assets/Scripts/Renamed.fcg");
    expect(renamed?.status).toBe("R");
    expect(renamed?.oldPath).toBe("Assets/Scripts/Old.fcg");
  });

  it("diffs against the working tree and reports untracked files", async () => {
    const summary = await diffSummary(repo, "feature", WORKTREE_REF);
    expect(summary.currentCommit).toBeNull();
    expect(summary.untrackedFiles).toBe(2);
    expect(summary.files.every((file) => file.status === "U")).toBe(true);
    expect(summary.files.map((file) => file.path)).toContain("Assets/CSV/New.csv");
  });

  it("rejects unresolvable refs and WORKTREE as base", async () => {
    await expect(resolveCommit(repo, "does-not-exist")).rejects.toMatchObject({
      code: ErrorCodes.unknownRef,
    });
    await expect(diffSummary(repo, WORKTREE_REF, "feature")).rejects.toBeInstanceOf(AppError);
  });

  it("reads tracked and untracked sources but skips ignored files", () => {
    const root = mkdtempSync(join(tmpdir(), "cqa-git-sources-"));
    try {
      git(root, ["init"]);
      mkdirSync(join(root, "Assets", "CSV"), { recursive: true });
      mkdirSync(join(root, "Temp"), { recursive: true });
      writeFileSync(join(root, ".gitignore"), "Temp/\nlog.log\n");
      writeFileSync(join(root, "Assets", "CSV", "Kept.csv"), "id\n1\n");
      writeFileSync(join(root, "Assets", "CSV", "Win.csv"), "id\r\n1\r\n");
      git(root, ["add", "-A"]);
      git(root, ["commit", "-m", "initial"]);
      writeFileSync(join(root, "Assets", "CSV", "New.csv"), "id\n2\n");
      writeFileSync(join(root, "Temp", "Ignored.csv"), "id\n3\n");
      writeFileSync(join(root, "log.log"), "noise");

      const files = readProjectFilesFromDisk(root);
      expect(files.map((file) => file.path)).toEqual([
        "Assets/CSV/Kept.csv",
        "Assets/CSV/New.csv",
        "Assets/CSV/Win.csv",
      ]);
      expect(files.find((file) => file.path === "Assets/CSV/Win.csv")?.source).toBe("id\n1\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("canonicalizes CRLF blobs read at a ref", async () => {
    const root = mkdtempSync(join(tmpdir(), "cqa-git-crlf-"));
    try {
      git(root, ["init"]);
      mkdirSync(join(root, "Assets", "CSV"), { recursive: true });
      writeFileSync(join(root, "Assets", "CSV", "Win.csv"), "id\r\n1\r\n");
      git(root, ["add", "-A"]);
      git(root, ["commit", "-m", "initial"]);

      const files = await readFilesAtRef(root, "HEAD");
      expect(files.find((file) => file.path === "Assets/CSV/Win.csv")?.source).toBe("id\n1\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("handles a repository without commits", async () => {
    const refs = await projectRefs(emptyRepo);
    expect(refs.head).toBeNull();
    expect(refs.refs).toEqual([]);
    expect(refs.dirty).toBe(false);
  });
});

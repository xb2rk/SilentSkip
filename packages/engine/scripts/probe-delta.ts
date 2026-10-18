#!/usr/bin/env tsx
/**
 * Dev probe: run `buildDeltaBundle` over a real git ref range of a project.
 *
 * Usage:
 *   pnpm --filter @silentskip/engine probe:delta <projectRoot> <baseRef> <currentRef>
 *
 * Lists the files changed between the two refs, keeps `.fcc`/`.fcg`/`.csv`/`.tsv`,
 * reads before/after content via `git show`, and reports the delta summary
 * (script statuses, symbol changes, table row changes) plus determinism.
 * Exits 1 when the bundle is not deterministic.
 */
import { execFileSync } from "node:child_process";
import { buildDeltaBundle, type SourceInput } from "../src/index.js";

const [, , rootArg, baseArg, currentArg] = process.argv;
if (rootArg === undefined || baseArg === undefined || currentArg === undefined) {
  console.error("usage: probe-delta <projectRoot> <baseRef> <currentRef>");
  process.exit(2);
}

// Bound after the guard so the helper closure below sees definite strings.
const projectRoot = rootArg;
const baseRef = baseArg;
const currentRef = currentArg;

/** Run git in the project root and return stdout as UTF-8 text. */
function git(args: readonly string[]): string {
  return execFileSync("git", ["-C", projectRoot, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
}

const DELTA_EXTENSIONS = /\.(fcc|fcg|csv|tsv)$/iu;

interface ChangedFile {
  path: string;
  oldPath: string | undefined;
  status: string;
}

const changedFiles: ChangedFile[] = [];
for (const line of git(["diff", "--name-status", "-M", baseRef, currentRef]).split(/\r?\n/u)) {
  if (line === "") continue;
  const [statusField, first, second] = line.split("\t");
  const status = statusField?.[0] ?? "";
  const oldPath = status === "R" ? first : undefined;
  const path = status === "R" || status === "C" ? second : first;
  if (path === undefined || !DELTA_EXTENSIONS.test(path)) continue;
  changedFiles.push({ path, oldPath, status });
}

/** Content of `path` at `ref`, or undefined when the file does not exist there. */
function show(ref: string, path: string): string | undefined {
  try {
    return git(["show", `${ref}:${path}`]);
  } catch {
    return undefined;
  }
}

const before: SourceInput[] = [];
const after: SourceInput[] = [];
for (const changed of changedFiles) {
  const beforePath = changed.oldPath ?? changed.path;
  if (changed.status !== "A") {
    const content = show(baseRef, beforePath);
    if (content !== undefined) before.push({ path: beforePath, source: content });
  }
  if (changed.status !== "D") {
    const content = show(currentRef, changed.path);
    if (content !== undefined) after.push({ path: changed.path, source: content });
  }
}

const bundle = buildDeltaBundle({ before, after });
const deterministic =
  JSON.stringify(bundle) === JSON.stringify(buildDeltaBundle({ before, after }));

let scriptsAdded = 0;
let scriptsRemoved = 0;
let scriptsChanged = 0;
let symbolsAdded = 0;
let symbolsRemoved = 0;
let symbolsChanged = 0;
for (const script of bundle.scripts) {
  if (script.status === "added") scriptsAdded += 1;
  else if (script.status === "removed") scriptsRemoved += 1;
  else scriptsChanged += 1;
  symbolsAdded += script.symbolsAdded.length;
  symbolsRemoved += script.symbolsRemoved.length;
  symbolsChanged += script.symbolsChanged.length;
}

let tablesAdded = 0;
let tablesRemoved = 0;
let tablesChanged = 0;
let rowsAdded = 0;
let rowsRemoved = 0;
let rowsChanged = 0;
let headerChanged = 0;
for (const table of bundle.tables) {
  if (table.status === "added") {
    tablesAdded += 1;
    rowsAdded += table.rowsAdded.length;
  } else if (table.status === "removed") {
    tablesRemoved += 1;
    rowsRemoved += table.rowsRemoved.length;
  } else {
    tablesChanged += 1;
    rowsAdded += table.rowsAdded.length;
    rowsRemoved += table.rowsRemoved.length;
    rowsChanged += table.rowsChanged.length;
    if (table.headerChanged) headerChanged += 1;
  }
}

console.log(`=== probe-delta: ${projectRoot} ===`);
console.log(`Range: ${baseRef}..${currentRef}`);
console.log(`Changed FC/CSV files: ${changedFiles.length}`);
console.log(
  `Scripts: added=${scriptsAdded} removed=${scriptsRemoved} changed=${scriptsChanged} | symbols +${symbolsAdded} -${symbolsRemoved} ~${symbolsChanged}`,
);
console.log(
  `Tables: added=${tablesAdded} removed=${tablesRemoved} changed=${tablesChanged} | rows +${rowsAdded} -${rowsRemoved} ~${rowsChanged} headerChanged=${headerChanged}`,
);
for (const script of bundle.scripts.slice(0, 12)) {
  console.log(
    `  [${script.status}] ${script.path} +${script.symbolsAdded.length} -${script.symbolsRemoved.length} ~${script.symbolsChanged.length}`,
  );
}
for (const table of bundle.tables.slice(0, 12)) {
  const stats =
    table.status === "added"
      ? `+${table.rowsAdded.length} rows`
      : table.status === "removed"
        ? `-${table.rowsRemoved.length} rows`
        : `+${table.rowsAdded.length} -${table.rowsRemoved.length} ~${table.rowsChanged.length} header=${table.headerChanged}`;
  console.log(`  [${table.status}] ${table.path} ${stats}`);
}
console.log(`Deterministic: ${deterministic}`);
process.exit(deterministic ? 0 : 1);

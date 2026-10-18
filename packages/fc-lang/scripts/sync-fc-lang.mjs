#!/usr/bin/env node
/**
 * Re-sync the vendored fc-format-v4 toolchain + corpus from upstream.
 *
 * Usage:
 *   pnpm --filter @silentskip/fc-lang sync:fc-lang
 *   FC_LANG_UPSTREAM="D:\path\to\tools\fc-format-v4" pnpm --filter @silentskip/fc-lang sync:fc-lang
 *
 * The upstream path defaults to the Craftland Studio workspace location. The script only
 * copies *into* this repo; upstream is never modified. After syncing, update PROVENANCE.md
 * (the script prints the upstream revision to record) and run the corpus gate.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const upstreamRoot =
  process.env.FC_LANG_UPSTREAM ??
  "C:\\Users\\\\Documents\\Craftland Studio\\Projects\\SampleProject\\tools\\fc-format-v4";

if (!existsSync(upstreamRoot)) {
  console.error(`Upstream not found: ${upstreamRoot}`);
  console.error("Set FC_LANG_UPSTREAM to the fc-format-v4 folder and retry.");
  process.exit(1);
}

const corpusSource = resolve(upstreamRoot, "..", "..", "Assets", "Scripts");
const FC_EXTENSIONS = new Set([".fcc", ".fcg"]);

// 1. src/ — replace the vendored subsystems only; our own files (vendored.ts) stay untouched.
const VENDORED_ENTRIES = ["grammar", "lex", "syntax", "parser", "imports", "format"];
const srcTarget = join(packageRoot, "src");
for (const entry of VENDORED_ENTRIES) {
  const target = join(srcTarget, entry);
  rmSync(target, { recursive: true, force: true });
  cpSync(join(upstreamRoot, "src", entry), target, { recursive: true });
}
cpSync(join(upstreamRoot, "src", "index.ts"), join(srcTarget, "index.ts"));

// 2. corpus/ — extension-filtered copy preserving relative paths.
const corpusTarget = join(packageRoot, "test", "corpus");
rmSync(corpusTarget, { recursive: true, force: true });
let corpusCount = 0;

function copyCorpus(directory, relative) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const source = join(directory, entry.name);
    const rel = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      copyCorpus(source, rel);
    } else if (FC_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      const target = join(corpusTarget, rel);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(source, target);
      corpusCount += 1;
    }
  }
}

copyCorpus(corpusSource, "");

const revision = execFileSync("git", ["-C", upstreamRoot, "log", "-1", "--format=%H %cI"], {
  encoding: "utf8",
}).trim();

console.log(`Synced from upstream: ${upstreamRoot}`);
console.log(`Upstream revision:    ${revision}`);
console.log(`Corpus files:         ${corpusCount}`);
console.log("Next: update PROVENANCE.md with the revision above, then run the corpus gate.");

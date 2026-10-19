#!/usr/bin/env node
/**
 * Re-sync the vendored fc-format-v4 toolchain from upstream.
 *
 * Usage:
 *   FC_LANG_UPSTREAM="D:\path\to\tools\fc-format-v4" pnpm --filter @silentskip/fc-lang sync:fc-lang
 *
 * The upstream path must be supplied via FC_LANG_UPSTREAM. The script only copies *into* this
 * repo; upstream is never modified. After syncing, update PROVENANCE.md and run the fixture gate.
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const upstreamRoot = process.env.FC_LANG_UPSTREAM;

if (upstreamRoot === undefined || upstreamRoot === "") {
  console.error("Set FC_LANG_UPSTREAM to the fc-format-v4 folder and retry.");
  process.exit(1);
}

if (!existsSync(upstreamRoot)) {
  console.error(`Upstream not found: ${upstreamRoot}`);
  process.exit(1);
}

// Replace the vendored subsystems only; our own files (vendored.ts) stay untouched.
const VENDORED_ENTRIES = ["grammar", "lex", "syntax", "parser", "imports", "format"];
const srcTarget = join(packageRoot, "src");
for (const entry of VENDORED_ENTRIES) {
  const target = join(srcTarget, entry);
  rmSync(target, { recursive: true, force: true });
  cpSync(join(upstreamRoot, "src", entry), target, { recursive: true });
}
cpSync(join(upstreamRoot, "src", "index.ts"), join(srcTarget, "index.ts"));

console.log(`Synced from upstream: ${upstreamRoot}`);
console.log("Next: update PROVENANCE.md, then run the fixture gate.");

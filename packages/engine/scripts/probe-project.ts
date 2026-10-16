/**
 * Dev probe — run the E2 fact + CSV pipeline over a real project folder and report honestly.
 *
 * Usage: pnpm --filter @craftland-qa/engine probe:project -- <projectRoot>
 *
 * Collects every `.fcc`/`.fcg` and `.csv` under the folder (skipping `.git` and
 * `node_modules`), builds the fact bundle, and prints: file counts, parse diagnostics
 * (never hidden), fact totals, reference-resolution stats, CSV anomalies, determinism and
 * timing. Exits 1 when any FC file fails to parse cleanly or the build is non-deterministic;
 * CSV anomalies are reported as warnings only (they are findings, not crashes).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { buildFactBundle, buildJourney, buildRelations, parseCsv } from "../src/index.js";

/** Directories that are never project source. */
const EXCLUDED_DIRS = new Set([".git", "node_modules"]);

/** Recursively collect files whose lowercase name ends with one of the extensions. */
function collectFiles(root: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) visit(join(directory, entry.name));
        continue;
      }
      const lower = entry.name.toLowerCase();
      if (extensions.some((extension) => lower.endsWith(extension)))
        found.push(join(directory, entry.name));
    }
  };
  visit(root);
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

const target = process.argv[2];
if (!target) {
  console.error("usage: pnpm --filter @craftland-qa/engine probe:project -- <projectRoot>");
  process.exit(2);
}
const root = resolve(target);
if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`not a directory: ${root}`);
  process.exit(2);
}

const relativePath = (file: string): string => relative(root, file).split("\\").join("/");

// ---- FC sources ----
const fcFiles = collectFiles(root, [".fcc", ".fcg"]);
const sources = fcFiles.map((file) => ({
  path: relativePath(file),
  source: readFileSync(file, "utf8"),
}));

const started = performance.now();
const bundle = buildFactBundle(sources);
const elapsedMs = Math.round(performance.now() - started);
const deterministic = JSON.stringify(bundle) === JSON.stringify(buildFactBundle(sources));

let symbols = 0;
let refs = 0;
let calls = 0;
let strings = 0;
let imports = 0;
let docComments = 0;
let resolved = 0;
let ambiguous = 0;
let unresolved = 0;
const problemFiles: string[] = [];
const dirCounts = new Map<string, number>();

for (const file of bundle.files) {
  symbols += file.symbols.length;
  refs += file.refs.length;
  calls += file.calls.length;
  strings += file.strings.length;
  imports += file.imports.length;
  docComments += file.docComments.length;
  for (const ref of file.refs) {
    if (ref.resolution.status === "resolved") resolved += 1;
    else if (ref.resolution.status === "ambiguous") ambiguous += 1;
    else unresolved += 1;
  }
  if (
    file.parse.lexDiagnostics > 0 ||
    file.parse.diagnostics > 0 ||
    !file.parse.consumedThroughEof
  ) {
    problemFiles.push(
      `${file.path} (lex=${file.parse.lexDiagnostics} parse=${file.parse.diagnostics} eof=${file.parse.consumedThroughEof})`,
    );
  }
  const topDir = file.path.includes("/") ? file.path.slice(0, file.path.indexOf("/")) : "(root)";
  dirCounts.set(topDir, (dirCounts.get(topDir) ?? 0) + 1);
}

// ---- CSV tables ----
const csvFiles = collectFiles(root, [".csv"]);
let csvAnomalies = 0;
let bomTables = 0;
const endings = { lf: 0, crlf: 0, cr: 0, mixed: 0 };
const csvProblemFiles: string[] = [];
for (const file of csvFiles) {
  const table = parseCsv(readFileSync(file, "utf8"));
  if (table.anomalies.length > 0) {
    csvAnomalies += table.anomalies.length;
    csvProblemFiles.push(
      `${relativePath(file)} (${table.anomalies.map((a) => `${a.kind}@${a.line}`).join(", ")})`,
    );
  }
  if (table.hasBom) bomTables += 1;
  endings[table.lineEnding] += 1;
}

// ---- Relations ----
const relationSet = buildRelations(bundle, { csvPaths: csvFiles.map(relativePath) });
const relationsDeterministic =
  JSON.stringify(relationSet) ===
  JSON.stringify(buildRelations(bundle, { csvPaths: csvFiles.map(relativePath) }));
const relationsByRule = new Map<string, number>();
const relationsByConfidence = new Map<string, number>();
for (const relation of relationSet.relations) {
  relationsByRule.set(relation.ruleId, (relationsByRule.get(relation.ruleId) ?? 0) + 1);
  relationsByConfidence.set(
    relation.confidence,
    (relationsByConfidence.get(relation.confidence) ?? 0) + 1,
  );
}

// ---- Value journeys (smoke) ----
const journeyTargets = csvFiles.map(relativePath);
const journeysWithChains: string[] = [];
let journeysDeterministic = true;
for (const target of journeyTargets) {
  const first = buildJourney({
    bundle,
    relations: relationSet,
    origin: { kind: "csv", path: target },
  });
  const second = buildJourney({
    bundle,
    relations: relationSet,
    origin: { kind: "csv", path: target },
  });
  if (JSON.stringify(first) !== JSON.stringify(second)) journeysDeterministic = false;
  if (first.chains.length > 0) journeysWithChains.push(`${target} (${first.chains.length})`);
}

// ---- Symbol journeys (smoke) ----
const symbolTargets: { file: string; symbolId: string }[] = [];
for (const file of bundle.files) {
  const symbol = file.symbols.find(
    (candidate) => candidate.kind === "function" || candidate.kind === "field",
  );
  if (symbol !== undefined) symbolTargets.push({ file: file.path, symbolId: symbol.id });
  if (symbolTargets.length >= 5) break;
}
const symbolJourneysWithChains: string[] = [];
for (const target of symbolTargets) {
  const journey = buildJourney({
    bundle,
    relations: relationSet,
    origin: { kind: "symbol", file: target.file, symbolId: target.symbolId },
  });
  if (journey.chains.length > 0) {
    symbolJourneysWithChains.push(`${journey.origin.label} (${journey.chains.length})`);
  }
}

// ---- Report ----
console.log(`=== probe: ${root} ===`);
console.log(`FC files: ${fcFiles.length} (built in ${elapsedMs}ms)`);
console.log(
  `  by top dir: ${[...dirCounts.entries()].map(([dir, count]) => `${dir}=${count}`).join(" ")}`,
);
console.log(
  `Parse: clean ${fcFiles.length - problemFiles.length}/${fcFiles.length}` +
    (problemFiles.length > 0
      ? ` — problems:\n    ${problemFiles.slice(0, 20).join("\n    ")}`
      : ""),
);
console.log(
  `Facts: symbols=${symbols} refs=${refs} calls=${calls} strings=${strings} imports=${imports} docComments=${docComments}`,
);
console.log(
  `Refs resolution: resolved=${resolved} ambiguous=${ambiguous} unresolved=${unresolved}`,
);
console.log(
  `Relations: total=${relationSet.relations.length} byRule=${JSON.stringify(Object.fromEntries([...relationsByRule.entries()].sort()))} byConfidence=${JSON.stringify(Object.fromEntries([...relationsByConfidence.entries()].sort()))}`,
);
console.log(
  `CSV: files=${csvFiles.length} anomalies=${csvAnomalies} bom=${bomTables} endings=${JSON.stringify(endings)}` +
    (csvProblemFiles.length > 0
      ? ` — problems:\n    ${csvProblemFiles.slice(0, 20).join("\n    ")}`
      : ""),
);
console.log(
  `Journeys: tables=${journeyTargets.length} withChains=${journeysWithChains.length} sample=${JSON.stringify(journeysWithChains.slice(0, 5))}`,
);
console.log(
  `Symbol journeys: tried=${symbolTargets.length} withChains=${symbolJourneysWithChains.length} sample=${JSON.stringify(symbolJourneysWithChains.slice(0, 5))}`,
);
console.log(
  `Deterministic: facts=${deterministic} relations=${relationsDeterministic} journeys=${journeysDeterministic}`,
);

const failed =
  problemFiles.length > 0 || !deterministic || !relationsDeterministic || !journeysDeterministic;
process.exit(failed ? 1 : 0);

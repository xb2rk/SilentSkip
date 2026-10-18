/**
 * Dev probe — print the first parse diagnostics of one `.fcc`/`.fcg` file with source context.
 *
 * Usage: pnpm --filter @silentskip/engine exec tsx scripts/diag-file.ts <file>
 *
 * Used during hardening sessions to characterise problem files without hiding anything:
 * every diagnostic line is shown next to the exact source line it points at.
 */
import { readFileSync } from "node:fs";
import { lex, parseGraphFile, parseHeaderFile } from "@silentskip/fc-lang";

const target = process.argv[2];
if (!target) {
  console.error("usage: pnpm --filter @silentskip/engine exec tsx scripts/diag-file.ts <file>");
  process.exit(2);
}

const source = readFileSync(target, "utf8");
const lines = source.split(/\r\n|\n|\r/);
const lexed = lex(source);
const parsed = target.toLowerCase().endsWith(".fcc")
  ? parseHeaderFile(lexed)
  : parseGraphFile(lexed);

console.log(`file: ${target}`);
console.log(`  size: ${source.length} chars, ${lines.length} lines`);
console.log(
  `  lex diagnostics: ${lexed.diagnostics.length}, parse diagnostics: ${parsed.diagnostics.length}, consumedThroughEof: ${parsed.consumedThroughEof}`,
);
for (const diagnostic of parsed.diagnostics.slice(0, 12)) {
  const lineNumber = diagnostic.range.start.line + 1;
  const columnNumber = diagnostic.range.start.column + 1;
  const lineText = lines[diagnostic.range.start.line] ?? "";
  console.log(`  [${lineNumber}:${columnNumber}] ${diagnostic.code}: ${diagnostic.message}`);
  console.log(`      ${lineText.trimEnd().slice(0, 160)}`);
}

import type { LocalizationIssueDraft } from "../localization/build.js";
import { analyzeLocalizationTable, detectLocalizationTable } from "../localization/build.js";
import type { CheckFinding, CheckInput } from "./types.js";

const KIND_LABELS: Record<LocalizationIssueDraft["kind"], string> = {
  "duplicate-key": "duplicate key(s)",
  "empty-key": "empty key(s)",
  "key-whitespace": "key(s) with surrounding whitespace",
  "empty-source": "empty source string(s)",
  "empty-translation": "empty translation(s)",
  "placeholder-mismatch": "placeholder mismatch(es)",
  "key-added": "added key(s)",
  "key-removed": "removed key(s)",
};

/**
 * LOC-01 - localization report integration for changed `*key.csv` tables.
 *
 * The dedicated localization page analyzes every detected table; a review run only emits
 * LOC-01 findings for localization tables that changed, so a pre-existing translation gap
 * does not flood an unrelated A/B report. Counts are exact observations from the table.
 */
export function checkLocalization(input: CheckInput): CheckFinding[] {
  const changed = new Set(
    input.delta.tables.filter((table) => table.status !== "removed").map((table) => table.path),
  );
  const findings: CheckFinding[] = [];

  for (const [path, table] of input.current.tables) {
    if (!changed.has(path)) continue;
    const source = input.current.sources.get(path);
    if (source === undefined) continue;
    const detected = detectLocalizationTable(path, source, table);
    if (detected === undefined) continue;

    const baseSource = input.base.sources.get(path);
    const baseTable = input.base.tables.get(path);
    const baseDetected =
      baseSource === undefined || baseTable === undefined
        ? undefined
        : detectLocalizationTable(path, baseSource, baseTable);
    const analysis = analyzeLocalizationTable(
      detected,
      baseDetected === undefined || baseSource === undefined
        ? undefined
        : { source: baseSource, table: baseDetected.table, detected: baseDetected },
    );

    for (const issue of analysis.issues) {
      const anchors = issue.anchors.map((anchor) =>
        input.registerAnchor(anchor.ref, anchor.file, anchor.span, "csv"),
      );
      const where = issue.column === undefined ? path : `${path} (${issue.column})`;
      const samples = issue.samples.length === 0 ? "" : `: ${issue.samples.join(", ")}`;
      findings.push({
        id: issue.id,
        ruleId: "LOC-01",
        severity: issue.severity,
        confidence: "exact",
        title: `Localization ${issue.kind.replaceAll("-", " ")}`,
        message: `${KIND_LABELS[issue.kind]} in ${where}: ${issue.count}${samples}`,
        anchors,
        derivation: [
          `detected a *key.csv localization table at ${path}`,
          `key rows: ${analysis.keyCount}; languages: ${analysis.languageCount}`,
          `counts are exact cell observations; placeholder comparison uses a multiset of {n}/printf tokens`,
        ],
      });
    }
  }

  return findings;
}

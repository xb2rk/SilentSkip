import type { DigestReadFinding, DigestReadOutput, DigOutput } from "@craftland-qa/contracts";

/** The structured, deduplicated findings that flow into `synthesize` — anchor ids, no prose. */
export interface StructuredFindings {
  readonly findings: readonly DigestReadFinding[];
  readonly unknowns: readonly string[];
  readonly negativeResults: readonly string[];
  readonly answers: readonly string[];
}

const SEVERITY_RANK = { critical: 0, major: 1, minor: 2, info: 3 } as const;

/**
 * The deterministic `[dig]` step: merge pass 1 with its focused follow-up.
 *
 * Findings are deduplicated by (normalized statement + sorted anchors) — first occurrence wins,
 * so pass-1 wording is preferred — then ordered by severity. No model involvement: this is the
 * seam where the citation verifier (E4.3) will later sit before `synthesize`.
 */
export function mergeReadOutputs(read: DigestReadOutput, dig?: DigOutput): StructuredFindings {
  const findings: DigestReadFinding[] = [];
  const seen = new Set<string>();
  for (const finding of [...read.findings, ...(dig?.findings ?? [])]) {
    const key = `${normalizeStatement(finding.statement)}|${[...finding.anchors].sort().join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(finding);
  }
  findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      normalizeStatement(a.statement).localeCompare(normalizeStatement(b.statement)),
  );
  return {
    findings,
    unknowns: dedupe([...read.unknowns, ...(dig?.unknowns ?? [])]),
    negativeResults: dedupe(read.negativeResults),
    answers: dig?.answers ?? [],
  };
}

function normalizeStatement(statement: string): string {
  return statement.trim().toLowerCase().replace(/\s+/gu, " ");
}

function dedupe(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const key = normalizeStatement(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

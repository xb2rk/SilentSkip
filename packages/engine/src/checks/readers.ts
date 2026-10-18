import { rowSpan } from "../csv/index.js";
import type { CheckFinding, CheckInput } from "./types.js";

/**
 * BIND-01 / BIND-02: reader expectations pinned in the project profile.
 *
 * The engine cannot infer how generated code binds CSV columns (name vs index) or what
 * guard constant a loop uses, so it never guesses. A `readerProfile` entry is a user
 * assertion; the check only compares that assertion with the current header. A mismatch is
 * exact because both sides are literal, and nothing is reported when no binding is pinned.
 */

export function checkReaderProfile(input: CheckInput): CheckFinding[] {
  const reader = input.profile?.readerProfile;
  if (reader === undefined) return [];

  const findings: CheckFinding[] = [];
  for (const binding of reader.bindings) {
    const table = input.current.tables.get(binding.csvPath);
    const header = table?.rows[0];
    if (table === undefined || header === undefined) {
      findings.push({
        id: `BIND-01|B|${binding.csvPath}|table-missing`,
        ruleId: "BIND-01",
        severity: "info",
        confidence: "exact",
        effectConfidence: "inferred",
        title: "Pinned reader table is not in the current tree",
        message: `The profile pins a name binding for ${binding.csvPath}, but no such CSV table exists on side B. Nothing was compared.`,
        anchors: [],
        derivation: [
          "The binding comes from the project profile (readerProfile.bindings).",
          "No file with that path exists in the current tree.",
        ],
      });
      continue;
    }

    const headerCells = header.cells.map((cell) => cell.text.trim());
    const missing = binding.columns.filter((column) => !headerCells.includes(column));
    if (missing.length === 0) continue;

    findings.push({
      id: `BIND-01|B|${binding.csvPath}`,
      ruleId: "BIND-01",
      severity: "critical",
      confidence: "exact",
      effectConfidence: "inferred",
      title: "Pinned name binding targets a missing column",
      message:
        `${binding.csvPath} is pinned as read by column name, but its header has no ` +
        `${missing.map((column) => `"${column}"`).join(", ")} on side B. ` +
        "A name lookup fails before any row is read, so the consumer is disabled.",
      anchors: [input.registerAnchor("B", binding.csvPath, rowSpan(header), "csv")],
      derivation: [
        `The profile pins name binding to ${binding.columns.map((column) => `"${column}"`).join(", ")}.`,
        `Header cells on side B: ${headerCells.join(", ")}.`,
        "Exact text comparison; a missing column means the reader cannot resolve it at runtime.",
      ],
    });
  }

  for (const guard of reader.guards) {
    const table = input.current.tables.get(guard.csvPath);
    const header = table?.rows[0];
    if (table === undefined || header === undefined) {
      findings.push({
        id: `BIND-02|B|${guard.csvPath}|table-missing`,
        ruleId: "BIND-02",
        severity: "info",
        confidence: "exact",
        effectConfidence: "inferred",
        title: "Pinned reader table is not in the current tree",
        message: `The profile pins a loop/guard constant for ${guard.csvPath}, but no such CSV table exists on side B. Nothing was compared.`,
        anchors: [],
        derivation: [
          "The guard comes from the project profile (readerProfile.guards).",
          "No file with that path exists in the current tree.",
        ],
      });
      continue;
    }

    const width = header.cells.length;
    if (width === guard.constant) continue;
    const wider = guard.constant > width;

    findings.push({
      id: `BIND-02|B|${guard.csvPath}`,
      ruleId: "BIND-02",
      severity: wider ? "critical" : "major",
      confidence: "exact",
      effectConfidence: "inferred",
      title: "Pinned reader guard differs from the header width",
      message:
        `${guard.csvPath} is pinned with a loop/guard constant of ${String(guard.constant)} ` +
        `but the header has ${String(width)} column(s) on side B. ` +
        (wider
          ? "An index read can go past the header (out of bounds) and the consumer falls back or is disabled."
          : "The guard stops before the header ends, so trailing columns are never read."),
      anchors: [input.registerAnchor("B", guard.csvPath, rowSpan(header), "csv")],
      derivation: [
        `The profile pins a guard constant of ${String(guard.constant)} (readerProfile.guards).`,
        `Header cells on side B: ${String(width)}.`,
        `Both sides are literals, so the mismatch is exact (${wider ? "guard > header" : "guard < header"}).`,
      ],
    });
  }

  return findings;
}

import { rowSpan } from "../csv/analysis.js";
import type { CheckFinding, CheckInput } from "./types.js";

/** Tolerance for extra enum members beyond header columns (index enums add a Length member). */
const INDEX_ENUM_EXTRA_MEMBERS = 2;

interface BindingCandidate {
  readonly file: string;
  readonly name: string;
  readonly memberCount: number;
}

function findBindingCandidate(
  input: CheckInput,
  headerCells: readonly string[],
): BindingCandidate | undefined {
  const headerSet = new Set(headerCells);
  for (const [file, facts] of input.current.factsByPath) {
    for (const symbol of facts.symbols) {
      if (symbol.kind !== "enum") continue;
      const members = facts.symbols.filter(
        (candidate) => candidate.kind === "enum-member" && candidate.container === symbol.name,
      );
      const memberNames = new Set(members.map((member) => member.name));
      if (memberNames.size < headerSet.size) continue;
      if (memberNames.size > headerSet.size + INDEX_ENUM_EXTRA_MEMBERS) continue;
      let covers = true;
      for (const cell of headerSet) {
        if (!memberNames.has(cell)) {
          covers = false;
          break;
        }
      }
      if (covers) return { file, name: symbol.name, memberCount: memberNames.size };
    }
  }
  return undefined;
}

function bindingFinding(input: CheckInput, path: string): CheckFinding[] {
  const table = input.current.tables.get(path);
  if (table === undefined) return [];
  const header = table.rows[0];
  if (header === undefined) return [];
  const headerCells = header.cells.map((cell) => cell.text.trim()).filter((text) => text !== "");
  if (headerCells.length < 2) return [];

  const boundByLiteral = new Set<string>();
  for (const relation of input.relations?.relations ?? []) {
    if (relation.ruleId === "string-names-csv" || relation.ruleId === "resource-enum-names-csv") {
      boundByLiteral.add(relation.to.file);
    }
  }
  const pinnedTarget = input.profile?.overrides
    .find(
      (override) =>
        override.kind === "pin-binding" &&
        override.target.csvPath === path &&
        override.value !== undefined &&
        override.value.trim() !== "",
    )
    ?.value?.trim();
  if (boundByLiteral.has(path) && pinnedTarget === undefined) return [];

  const candidate = findBindingCandidate(input, headerCells);
  const headerAnchor = input.registerAnchor("B", path, rowSpan(header), "csv");

  if (candidate !== undefined) {
    const exact = pinnedTarget === candidate.name;
    return [
      {
        id: `BIND-03|B|${path}`,
        ruleId: "BIND-03",
        severity: "info",
        confidence: exact ? "exact" : "inferred",
        title: exact
          ? "Pinned binding: table rows are indexed by this enum"
          : "Candidate binding: enum matches every header column",
        message: exact
          ? `The project profile pins ${path} to enum ${candidate.name} (${candidate.file}) — every header column is a member of that enum.`
          : `Enum ${candidate.name} in ${candidate.file} has one member per header column of ${path} ` +
            `(${candidate.memberCount} members). This looks like the table's index enum — a candidate binding only. ` +
            `Pin it (pin-binding override for ${path}) to make this binding exact.`,
        anchors: [headerAnchor],
        derivation: [
          `Header cells of ${path} (side B): ${headerCells.length}.`,
          `Enum ${candidate.name}: ${candidate.memberCount} members; every header cell present among member names (exact text match, index-enum shape).`,
          exact
            ? `Profile override (pin-binding) pins ${path} to ${candidate.name}.`
            : "No pin — the binding is a candidate (inferred), never a hard fact.",
        ],
      },
    ];
  }

  if (pinnedTarget !== undefined) {
    return [
      {
        id: `BIND-03|B|${path}|pin-missing`,
        ruleId: "BIND-03",
        severity: "info",
        confidence: "exact",
        title: "Pinned binding target not found",
        message:
          `The project profile pins ${path} to "${pinnedTarget}", but no current enum matches that name ` +
          `with the table's header columns. The pinned convention cannot be verified.`,
        anchors: [headerAnchor],
        derivation: [
          `Profile override (pin-binding) for ${path}: "${pinnedTarget}".`,
          "No enum in the current file set covers every header column under that name.",
        ],
      },
    ];
  }

  if (boundByLiteral.has(path)) return [];
  return [
    {
      id: `BIND-04|B|${path}`,
      ruleId: "BIND-04",
      severity: "info",
      confidence: "exact",
      title: "No code reference found for this changed table",
      message:
        `Checked every current file: no string literal or EResCSV member names ${path} and no enum matches its header columns. ` +
        `Its runtime use is unknown — if the table is loaded dynamically, pin a binding to make the link exact.`,
      anchors: [headerAnchor],
      derivation: [
        `Searched ${input.current.factsByPath.size} current script file(s) for string literals naming the table, EResCSV member names (when editorGen indexing is enabled), and enums covering every header column.`,
        "No reference found — the absence is exact; the runtime use stays unknown (channel ③).",
      ],
    },
  ];
}

/**
 * BIND-03 / BIND-04 — candidate bindings and orphan changed tables.
 */
export function checkBindings(input: CheckInput): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const delta of input.delta.tables) {
    if (delta.status === "removed") continue;
    findings.push(...bindingFinding(input, delta.path));
  }
  return findings;
}

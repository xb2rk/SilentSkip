/**
 * Foreign-key pins: the profile says "this column references that table", the engine compares.
 *
 * The engine cannot know that a CSV column points at another table, so intent is pinned:
 * `pin-fk` with `target.csvPath` = referencing table, `target.rowKey` = referencing column and
 * `value` = `<targetCsvPath>#<int|string|unknown>`. The runtime cast decides the comparison
 * (`int` compares numerically, `string` compares exactly); an unknown cast is never concluded
 * on. Kept next to the CSV analysis because checks and surfaces must share it verbatim.
 */

import type { ProjectProfile } from "@silentskip/contracts";

/** Cast declared by a foreign-key pin; `unknown` means "the runtime decides, do not conclude". */
export type Cast = "int" | "string" | "unknown";

/** One resolved FK pin: source column → target table, under a declared cast. */
export interface FkPin {
  readonly sourcePath: string;
  readonly sourceColumn: string;
  readonly targetPath: string;
  readonly cast: Cast;
}

function parseCast(token: string | undefined): Cast {
  if (token === "int" || token === "string") return token;
  return "unknown";
}

/** Parses `<targetPath>#<cast>`; the path may contain `#`, so split on the last one. */
function parseFkValue(value: string | undefined): { targetPath: string; cast: Cast } | undefined {
  if (value === undefined) return undefined;
  const split = value.lastIndexOf("#");
  if (split <= 0 || split === value.length - 1) return undefined;
  return {
    targetPath: value.slice(0, split).trim(),
    cast: parseCast(value.slice(split + 1).trim()),
  };
}

/** All usable `pin-fk` overrides of a profile; malformed pins are silently skipped. */
export function fkPins(profile: ProjectProfile | undefined): FkPin[] {
  const pins: FkPin[] = [];
  for (const override of profile?.overrides ?? []) {
    if (override.kind !== "pin-fk") continue;
    const sourcePath = override.target.csvPath;
    const sourceColumn = override.target.rowKey;
    const parsed = parseFkValue(override.value);
    if (sourcePath === undefined || sourceColumn === undefined || parsed === undefined) continue;
    pins.push({ sourcePath, sourceColumn, targetPath: parsed.targetPath, cast: parsed.cast });
  }
  return pins;
}

/** Normalizes one value under the declared cast; `undefined` means it cannot match. */
export function normalizeCastValue(value: string, cast: Cast): string | undefined {
  if (cast === "string") return value;
  if (cast !== "int") return undefined;
  const trimmed = value.trim();
  if (!/^-?\d+$/u.test(trimmed)) return undefined;
  try {
    return BigInt(trimmed).toString();
  } catch {
    return undefined;
  }
}

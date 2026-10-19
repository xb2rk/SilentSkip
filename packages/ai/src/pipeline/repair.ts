import type { SynthesizeOutput } from "@silentskip/contracts";
import { evaluateClaim, type FactIndex } from "../facts/fact-index.js";
import type { NormalizedTheme } from "../passes/map.js";

/**
 * Fast repair gate for synthesize output: mechanically repairs fixable issues (e.g., dropping
 * invalid/false claims so statements survive) to avoid an expensive re-synthesis round that could
 * time out. Missing theme narratives are only filled on the final round, and the filler says
 * plainly that no narrative was written — never a generic sentence that reads like an analysis the
 * model never produced.
 */
export function fastRepairSynthesizeOutput(
  raw: SynthesizeOutput,
  index: FactIndex,
  normalizedThemes: readonly NormalizedTheme[],
  fillMissingThemes: boolean,
): SynthesizeOutput | null {
  let modified = false;

  const findings = raw.findings.map((f) => {
    if (f.claims && f.claims.length > 0) {
      const validClaims = f.claims.filter((c) => {
        try {
          return evaluateClaim(c, index) === "true";
        } catch {
          return false;
        }
      });
      if (validClaims.length !== f.claims.length) {
        modified = true;
        return {
          ...f,
          claims: validClaims,
          confidence: f.confidence === "exact" ? ("inferred" as const) : f.confidence,
        };
      }
    }
    return f;
  });

  const themes = [...raw.themes];
  if (fillMissingThemes) {
    const presentThemeIds = new Set(raw.themes.map((theme) => theme.themeId));
    for (const theme of normalizedThemes) {
      if (presentThemeIds.has(theme.id)) continue;
      modified = true;
      themes.push({
        themeId: theme.id,
        summary: `No narrative was written for theme "${theme.name}" — see its carried findings.`,
        behaviorChange: "Not stated by the model; the anchored findings describe what changed.",
        watchFor: "Read this theme's files and verify the change in game.",
        anchorIds: [],
      });
    }
  }

  if (!modified) return null;
  return {
    ...raw,
    findings,
    themes,
  };
}

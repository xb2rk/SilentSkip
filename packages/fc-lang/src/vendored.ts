/**
 * Machine-readable provenance for the vendored `fc-format-v4` toolchain.
 *
 * Why: diagnostics (versions panel), sync tooling and tests need to state *which* upstream
 * revision the checked-in language layer corresponds to. The full human-readable story lives
 * in `PROVENANCE.md`; this module is the single place code reads it from.
 */

/** Marker: the FC language layer in this package is a vendored upstream copy (not a stub). */
export const FC_LANG_VENDORED = true;

/** Upstream package the vendored `src/` tree was copied from. Keep in sync with PROVENANCE.md. */
export const FC_LANG_UPSTREAM = {
  package: "fc-format-v4",
  version: "0.4.0",
  syncedAt: "2026-10-16",
} as const;

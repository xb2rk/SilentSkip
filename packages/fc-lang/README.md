# @craftland-qa/fc-lang (placeholder)

This package will contain the **vendored** `fc-format-v4` toolchain from the Craftland Studio
workspace (`tools/fc-format-v4`): lossless lexer, AST parser, visitor, formatter for the FC
language (`.fcc`/`.fcg`).

## Why vendored

The upstream toolchain is the authority on the FC grammar; vendoring pins the exact behavior we
build on, keeps the tool free of a dependency on the Studio installation, and makes drift
reviewable.

## Vendoring checklist (Phase 1 / E2)

- `PROVENANCE.md` — upstream path, version/commit/date, list of local modifications (if any)
- `sync:fc-lang` script to re-copy from upstream deterministically
- the upstream corpus test (164 checked-in FC files) wired into CI

Until then this package is an empty shell so the workspace layout is final.

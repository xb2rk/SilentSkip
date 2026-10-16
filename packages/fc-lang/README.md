# @craftland-qa/fc-lang (placeholder)

This package will contain the **vendored** `fc-format-v4` toolchain from the Craftland Studio
workspace (`tools/fc-format-v4`): lossless lexer, AST parser, visitor, formatter for the FC
language (`.fcc`/`.fcg`).

Vendoring happens in **Phase 1 / E2** and must include:

- `PROVENANCE.md` (upstream path, version, commit/date, what was modified)
- `sync:fc-lang` script to re-copy from upstream deterministically
- the upstream corpus test (164 checked-in FC files) wired into CI

Until then this package is an empty shell so the workspace layout is final.

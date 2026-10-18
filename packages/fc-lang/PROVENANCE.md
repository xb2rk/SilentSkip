# Provenance — vendored `fc-format-v4`

`src/` in this package is a copy of the upstream FC language toolchain; `test/corpus/` is a
copy of the sample project's checked-in FC sources. This file records exactly what was copied,
from where, and every intentional deviation. Re-sync with:

```sh
pnpm --filter @silentskip/fc-lang sync:fc-lang
```

## Upstream

| | |
| --- | --- |
| Package | `fc-format-v4` v0.4.0 |
| Path | `C:\Projects\Documents\Craftland Studio\Projects\SampleProject\tools\fc-format-v4` |
| Git commit | `418d7d6f3764071669bd3b35a613b62680fbda00` |
| Commit date | 2026-10-15 17:10:45 +07:00 |
| Synced | 2026-10-16 |

## What was copied

| Item | Destination | Notes |
| --- | --- | --- |
| `src/**` except `src/cli/**` (42 files) | `src/**` | Byte-identical |
| `Assets/Scripts/**/*.{fcc,fcg}` of the Sample project (245 files, 3,629,895 bytes) | `test/corpus/**` | Extension-filtered, relative paths preserved |
| `tests/helpers/semantic-fingerprint.ts` | `test/helpers/semantic-fingerprint.ts` | Logic verbatim; reformatted to repo Biome style |
| `tests/helpers/workspace.ts` | `test/helpers/corpus.ts` | Adapted: corpus root points at the checked-in `test/corpus` |
| `tests/format/formatter-corpus.test.ts` | `test/formatter-corpus.test.ts` | Adapted: package imports, 300s timeout (245 files) |

## What was NOT copied (deliberately)

- `src/cli/**` — the formatter CLI (format/diff/diagnostics commands) is not needed by the QA tool.
- Remaining upstream tests (`tests/**` outside the corpus gate) — they keep living upstream;
  run them there with `pnpm test`.
- `tests/fixtures/**`, `schema.json`, `scripts/gen-token-vocabulary.mjs`, `dist/` — upstream
  build and editor-support artifacts.

## Modifications to vendored `src/`

None — `src/**` is byte-identical to upstream. If this ever changes, list every touched file and
the reason here. Policy: fixes belong **upstream first**, then re-sync; this copy is not a fork.

`src/**` and `test/corpus/**` are excluded from Biome at the repo root (`biome.json`) so the copy
survives `pnpm format` untouched. Quality gates for the vendored tree are TypeScript strictness
(`pnpm typecheck`) and the corpus gate (`pnpm test`).

## Versioning

`packages/fc-lang/package.json` mirrors the upstream minor (`0.4.0`). The exact upstream revision
is the git commit above, also exported at runtime from `src/vendored.ts`.

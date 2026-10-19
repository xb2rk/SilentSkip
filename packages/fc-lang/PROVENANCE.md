# Provenance — vendored `fc-format-v4`

`src/` in this package is a copy of the upstream FC language toolchain; `test/fixtures/` holds
hand-written synthetic FC samples. This file records exactly what was copied and every
intentional deviation. Re-sync with:

```sh
FC_LANG_UPSTREAM="<path-to>/fc-format-v4" pnpm --filter @silentskip/fc-lang sync:fc-lang
```

## Upstream

| | |
| --- | --- |
| Package | `fc-format-v4` v0.4.0 |
| Source | Private upstream checkout (path supplied via `FC_LANG_UPSTREAM`) |
| Synced | 2026-10-16 |

## What was copied

| Item | Destination | Notes |
| --- | --- | --- |
| `src/**` except `src/cli/**` (42 files) | `src/**` | Byte-identical |
| `tests/helpers/semantic-fingerprint.ts` | `test/helpers/semantic-fingerprint.ts` | Logic verbatim; reformatted to repo Biome style |
| `tests/helpers/workspace.ts` | `test/helpers/fixtures.ts` | Adapted: root points at the checked-in `test/fixtures` |
| `tests/format/formatter-corpus.test.ts` | `test/formatter-fixtures.test.ts` | Adapted: package imports, 300s timeout (fixture set) |

## What was NOT copied (deliberately)

- `src/cli/**` — the formatter CLI (format/diff/diagnostics commands) is not needed by the QA tool.
- Remaining upstream tests (`tests/**` outside the fixture gate) — they keep living upstream;
  run them there with `pnpm test`.
- `tests/fixtures/**`, `schema.json`, `scripts/gen-token-vocabulary.mjs`, `dist/` — upstream
  build and editor-support artifacts.

## Modifications to vendored `src/`

None — `src/**` is byte-identical to upstream. If this ever changes, list every touched file and
the reason here. Policy: fixes belong **upstream first**, then re-sync; this copy is not a fork.

`src/**` and `test/fixtures/**` are excluded from Biome at the repo root (`biome.json`) so the copy
survives `pnpm format` untouched. Quality gates for the vendored tree are TypeScript strictness
(`pnpm typecheck`) and the fixture gate (`pnpm test`).

## Versioning

`packages/fc-lang/package.json` mirrors the upstream minor (`0.4.0`). The upstream package and
version are also exported at runtime from `src/vendored.ts`.

# @silentskip/fc-lang

Vendored **FC language toolchain** (`fc-format-v4`): lossless lexer, AST parser with guards,
visitor, import sorter and formatter for Craftland Studio scripts (`.fcc`/`.fcg`).

This is the only place in the repo that understands FC syntax. The engine (`packages/engine`)
builds its facts, relations and journeys *on top of* this package — it must never re-implement
lexing or parsing.

## Layout

| Path | What |
| --- | --- |
| `src/**` | Vendored upstream `fc-format-v4` source — byte-identical, never edited in place |
| `src/vendored.ts` | Runtime provenance marker (`FC_LANG_VENDORED`, upstream revision) |
| `test/corpus/**` | Checked-in copy of the sample project's FC sources (245 files) |
| `test/formatter-corpus.test.ts` | Corpus gate: parse + format + reparse + semantic fingerprint |
| `PROVENANCE.md` | Upstream path, revision, what was copied, deviations |
| `scripts/sync-fc-lang.mjs` | Re-sync from upstream (`pnpm --filter @silentskip/fc-lang sync:fc-lang`) |

## Entry points

```ts
import { lex, parseGraphFile, parseHeaderFile, formatSource } from "@silentskip/fc-lang";
import { FC_LANG_UPSTREAM } from "@silentskip/fc-lang/vendored";
```

Subpath exports (`/grammar`, `/lex`, `/syntax`, `/parser`, `/imports`, `/format`) mirror the
upstream barrels for consumers that want a narrower surface.

## Rules

- **Never edit `src/**` in place.** Fixes belong upstream first; then re-sync and update
  `PROVENANCE.md`. The corpus gate must stay green.
- `.fcc` = header file (`parseHeaderFile`), `.fcg` = graph file (`parseGraphFile`) — pick by
  extension, exactly like the corpus gate does.
- The corpus is deliberately checked in: it is the clean-machine CI proof that the parser
  handles every real-world file of the sample project.

## Commands

```sh
pnpm --filter @silentskip/fc-lang typecheck   # strict TS over src + test
pnpm --filter @silentskip/fc-lang test        # includes the 245-file corpus gate
pnpm --filter @silentskip/fc-lang sync:fc-lang # re-copy from upstream (env FC_LANG_UPSTREAM overrides path)
```

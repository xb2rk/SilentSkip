# @silentskip/db

Persistence layer: Drizzle schema, the `node:sqlite` client, and generated migrations.

## Why `node:sqlite`

Single-user local tool, so a synchronous built-in driver is ideal: zero native dependencies
(packaging ships without build tools), identical API in dev and tests (in-memory). We use
`drizzle-orm`/`drizzle-kit` **pinned to `1.0.0-rc.4`** — see plan decision #23 for why
`better-sqlite3` was rejected (no Node 24 prebuilt; machine without VS C++ toolchain).

## Files

| File | Contents |
| --- | --- |
| `src/client.ts` | `openDatabase(path)`, `migrateDatabase(db)` (also `":memory:"` for tests) |
| `src/schema.ts` | Full table set — `projects` is live; later-phase tables are reserved so migrations stay linear |
| `migrations/` | Generated SQL + journal, committed (never hand-edit) |

## Migration workflow

```sh
# 1. edit src/schema.ts
pnpm db:generate       # from repo root — regenerates migrations via drizzle-kit
# 2. commit schema + generated files together
```

The app runs `migrateDatabase()` at boot, so a fresh checkout works with no manual steps.

## Testing

`pnpm --filter @silentskip/db test` — schema tests run against `openDatabase(":memory:")`.
Server tests use the same pattern; nothing ever touches the real user database in tests.

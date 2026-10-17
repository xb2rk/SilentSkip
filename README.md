# Craftland QA

Local-first A/B review tool for Craftland Studio projects. It compares two git refs (A/B) across
CSV configuration and FC code (`.fcc`/`.fcg`), surfaces config ↔ code mismatches, and produces an
AI review whose claims are grounded in verifiable evidence anchors.

Primary audience: **game designers** — the UI is Vietnamese and i18n-ready. Secondary: developers —
technical docs are English.

> Status: **Phase 1 — Knowledge core & AI review**. E0–E3 are complete — vendored `fc-lang`,
> raw-faithful CSV parser, FactBundle / DeltaBundle / Relations / Value Journey, the profile
> store, and the deterministic digest served over the first real API
> (`GET /api/projects/:id/digest`) — all guarded by corpus gates (245 FC + 33 CSV).
> E4 (AI pipeline: Insea client, prompt passes, citation verifier) is next.
> The locked master plan lives outside the repo; in-repo product docs are [`ARCHITECTURE.md`](./ARCHITECTURE.md)
> and the per-package READMEs.

## Requirements

- Node >= 24 (uses the built-in `node:sqlite` module — no native build tools needed)
- pnpm 10.x

## Getting started

```sh
pnpm install
pnpm dev
```

- API server: <http://127.0.0.1:3000> (`/api/health`)
- Web app: <http://127.0.0.1:5173> (proxies `/api` to the server)

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Runs server + web together (turbo) |
| `pnpm build` | Builds all packages that have a build step |
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `pnpm test` | Vitest across the workspace |
| `pnpm lint` / `pnpm format` | Biome check / autofix |
| `pnpm verify` | typecheck + lint + test + build (the quality gate) |
| `pnpm db:generate` | Regenerate SQLite migrations after changing `packages/db/src/schema.ts` |

## Repository layout

```
apps/server        Hono API server — HTTP surface, read-only git, project registry
apps/web           Vite + React 19 SPA — designer UI (Vietnamese, i18n-ready)
packages/contracts Zod schemas + inferred types — single source of truth for every DTO
packages/db        Drizzle schema, node:sqlite client, migrations
packages/engine    Deterministic analysis engine (E2+: facts, relations, journeys, digest, checks)
packages/ai        Insea client, prompt passes, citation verifier (E4+)
packages/fc-lang   Vendored fc-format-v4 toolchain for `.fcc`/`.fcg` (v0.4.0)
```

Each app/package has its own README covering purpose, extension points and testing.

## Engineering rules

- **Contracts are the single source of truth.** Every HTTP payload is parsed through its Zod
  schema at both boundaries; TypeScript types are `z.infer` aliases, never hand-written clones.
- **TSDoc on every export** explains *why* and the invariants — not restated types. Schemas own the
  documentation for their inferred type aliases (no duplicated mechanical comments).
- **Determinism**: engine code reads no clocks, no randomness — same inputs + same version must
  produce identical output. This is what makes tests and eval runs reproducible.
- **Engine philosophy**: only the FC grammar, CSV format and git are assumed. No project-specific
  heuristics; conventions are discovered and then **pinned by the user**, never guessed.
- **Local-first**: the server only reads. Nothing ever writes into a user project, and git access
  is strictly non-mutating.

## Quality gate

`pnpm verify` (typecheck + lint + tests + build) must be green before every commit.

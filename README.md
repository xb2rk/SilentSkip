# Craftland QA

Local-first A/B review tool for Craftland Studio projects. It compares two git refs (A/B) across
CSV configuration and FC code (`.fcc`/`.fcg`), surfaces config ↔ code mismatches, and produces an
AI review whose claims are grounded in verifiable evidence anchors.

Primary audience: **game designers** — the UI is Vietnamese and i18n-ready. Secondary: developers —
technical docs are English.

> Status: **Phase 1 — Knowledge core & AI review (complete)**. E0–E5 are complete: vendored
> `fc-lang`, raw-faithful CSV parser, FactBundle / DeltaBundle / Relations / Value Journey, the
> profile store, the deterministic digest API, the Insea pass pipeline with the mandatory citation
> verifier, the review-run API (SSE progress, cancel, deterministic fallback, SQLite persistence),
> and the report UI (run page with evidence viewer + history). The full loop works end to end:
> register a project → pick A/B → start a review → watch live progress → read a verified report.
> E7 is complete (decision #28): **E7.1 engine core v2, E7.2/E7.2.1 AI flow v2 (map → read×N,
> fact-id citations, linker gates, L1/L3 loops, repair-and-fallback for every pass), E7.3 checks
> full (STRUCT-02/03, TYPE-01, BIND-03/04, PK pins), E7.4 report v2 (theme change map,
> FACT/INTERPRETATION split, "Cần xác minh" label, L4 re-measure) and E7.5 report depth
> (function bodies + chunked reads, CALL-ARITY/ORPHAN-ADD checks, structured theme narratives)
> are in.** E6 is in — the What-If chat: sessions + pins scoped to one A/B comparison, Vietnamese
> answers with verified evidence vs labelled speculation, ledger-based memory on the stateless
> Insea pipeline. E9 is in — deterministic LOC-01 localization reports (detected `*key.csv`
> tables, placeholder multisets, coverage), git attribution, two-run history compare with a
> silent-skip chart, and a persisted engine-finding set per run. E10 (What-If recompute and
> report export) is next.
> The locked master plan lives outside the repo; in-repo product docs are [`ARCHITECTURE.md`](./ARCHITECTURE.md),
> [`docs/INSEA.md`](./docs/INSEA.md), [`docs/PROMPTS.md`](./docs/PROMPTS.md) and the per-package READMEs.

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
docs               Insea integration + prompt-pass contracts
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

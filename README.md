# Craftland QA

Local-first A/B review tool for Craftland Studio projects. Compares two git refs (A/B) across
CSV configuration and FC code (`.fcc`/`.fcg`), surfaces config ↔ code mismatches, and produces
an AI review whose claims are grounded in verifiable evidence anchors.

Primary audience: **game designers**. Secondary: developers.

> Status: Phase 1 (E0 walking skeleton). The locked master plan lives outside the repo; product
> docs (`docs/ARCHITECTURE.md`, `docs/CHECKS.md`, `docs/PROMPTS.md`, `docs/INSEA.md`) land during
> Phase 1 and Phase 2.

## Requirements

- Node >= 24 (uses the built-in `node:sqlite` module — no native build tools needed)
- pnpm 10.x

## Getting started

```sh
pnpm install
pnpm dev
```

- API server: http://127.0.0.1:3000 (`/api/health`)
- Web app: http://localhost:5173 (proxies `/api` to the server)

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Runs server + web together (turbo) |
| `pnpm build` | Builds all packages that have a build step |
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `pnpm test` | Vitest across the workspace |
| `pnpm lint` / `pnpm format` | Biome check / autofix |
| `pnpm verify` | typecheck + lint + test + build |
| `pnpm db:generate` | Regenerate SQLite migrations after changing `packages/db/src/schema.ts` |

## Layout

```
apps/server        Hono API server (SSE, git, orchestration)
apps/web           Vite + React 19 SPA (TanStack, Tailwind v4, shadcn-style UI)
packages/contracts Zod schemas shared across the stack (single source of truth for types)
packages/db        Drizzle schema + node:sqlite client + migrations
packages/engine    Deterministic analysis engine (E2+: syntax graph, journeys, checks)
packages/ai        Insea client, passes, verifier (E4+)
packages/fc-lang   Vendored fc-format-v4 language toolchain (E2)
```

### Ground rules

- Internal packages export TypeScript source directly (`"exports": "./src/index.ts"`); the web app
  is bundled by Vite, the server is run by `tsx` in dev and bundled for packaging later.
- Every exported symbol carries TSDoc explaining **why + invariants**, not just restated types.
- Deterministic engine code: no clocks, no randomness — same inputs and version must produce the
  same output.
- All HTTP contracts live in `packages/contracts` (Zod). Types are inferred from schemas.

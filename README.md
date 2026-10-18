# Craftland QA

Local-first A/B review tool for Craftland Studio projects. It compares two git refs (A/B) across
CSV configuration and FC code (`.fcc`/`.fcg`), surfaces configuration ↔ code mismatches that
silently break games at runtime, and produces an AI review whose claims are grounded in verifiable
evidence anchors.

Primary audience: **game designers** — the UI is Vietnamese and i18n-ready. Secondary: developers —
technical docs are English.

> **Status**: E0–E9 shipped · E10 next · E11 planned — see
> [`ARCHITECTURE.md` §9](./ARCHITECTURE.md#9-roadmap-pointer) for the epoch map.

## Highlights

- **Deterministic analysis engine** — parses FC code (vendored `fc-format-v4` toolchain) and CSV
  into facts, relations, value journeys and A/B deltas. No clocks, no randomness: same inputs +
  same version produce identical output, which is what makes tests and eval runs reproducible.
- **Evidence-grounded AI review** — the model narrates, the engine decides: numbers travel as
  `{{f:<factId>}}` placeholders, structural comparisons are typed claims the engine evaluates
  itself, and the linker strips or downgrades every claim it cannot verify against the digest
  registry.
- **Deterministic checks with honest confidence** — STRUCT / TYPE / BIND / DRIFT / REF /
  DANGLING-REF / CALL-ARITY / ORPHAN-ADD / LOC-01 findings run over the full scope, each carrying
  severity, confidence (`exact`/`inferred`), runtime-effect confidence and witness anchors.
  Project conventions are **pinned by the user**, never guessed — see
  [`docs/CHECKS.md`](./docs/CHECKS.md).
- **Silent-skip surface** — a deterministic panel of loader mechanisms that quietly drop or
  default data at runtime: length guards, parse failures, duplicate keys, missing bindings, empty
  required cells, enum fallbacks and broken foreign keys.
- **Review runs that never fail flakily** — background execution with live SSE progress, cancel
  support and SQLite persistence. When the AI is unavailable, the run still completes with an
  honest deterministic fallback report instead of a flaky failure.
- **What-If chat** — ask questions about a single A/B comparison; sessions and pins survive new
  runs of the same pair, and answers separate verified evidence (clickable, pinnable anchors) from
  labelled speculation and unknowns.
- **Localization, attribution & history** — deterministic LOC-01 reports (shape-detected
  localization tables, placeholder multisets, per-language coverage, duplicate/empty keys),
  read-only git attribution (commits per changed file, line-level blame) and a two-run compare
  with a silent-skip chart.
- **Local-first & read-only** — the server never writes into your project and git access is
  strictly non-mutating; only the digested context from an explicit user action ever leaves the
  machine.

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

### Configuration

Everything runs without configuration; copy `.env.example` to `.env` to override defaults.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | API server port |
| `HOST` | `127.0.0.1` | Bind host — this tool is local-first |
| `LOG_LEVEL` | `debug` in dev, `info` in production | pino log level |
| `SQLITE_PATH` | `%LOCALAPPDATA%\CraftlandQA\data.sqlite` (Windows), `~/.craftland-qa/data.sqlite` | SQLite database file |
| `AI_WORKFLOW_URL` | — | Insea workflow run endpoint |
| `AI_WORKFLOW_API_KEY` | — | Bearer token for the endpoint |
| `AI_WORKFLOW_TIMEOUT_MS` | `180000` | Per-request AI timeout |

AI is optional: without `AI_WORKFLOW_URL`/`AI_WORKFLOW_API_KEY` reviews still complete with the
deterministic fallback report. Verify connectivity with
`pnpm --filter @craftland-qa/ai canary`.

### First run

1. **Register a project** — point the server at a local Craftland Studio project root (absolute
   path; registration is fully manual, the server never scans for projects).
2. **Pick A/B** — choose the base and current refs. `WORKTREE` is a valid pseudo-ref for the
   *current* side: it diffs against the working tree, including untracked files.
3. **Start a review** — it runs in the background; the run page streams live progress over SSE and
   the run can be cancelled at any time.
4. **Read the report** — a theme change map over the raw change facts; findings split **FACT**
   (deterministic engine checks) from **INTERPRETATION** (linked AI findings, unverified ones
   labelled "Cần xác minh"); the AI notes tab carries the full audit trail.
5. **Dig deeper** — follow-up questions in What-If (scoped to the comparison), a deterministic
   Localization report, or a side-by-side compare of two runs in History.

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

Diagnostic probes worth knowing:

- `pnpm --filter @craftland-qa/ai canary` — one real Insea round-trip (latency, salvage rung).
- `pnpm --filter @craftland-qa/ai review:once <projectId> <base> <current>` — the full review
  pipeline against a running dev server.
- `pnpm --filter @craftland-qa/engine probe:project <root>` / `probe:delta <root> <base> <current>`
  — fact/CSV and delta pipelines over a real project, with determinism checks.

## Repository layout

```
apps/server         Hono API server — HTTP surface, read-only git, project registry
apps/web            Vite + React 19 SPA — designer UI (Vietnamese, i18n-ready)
packages/contracts  Zod schemas + inferred types — single source of truth for every DTO
packages/db         Drizzle schema, node:sqlite client, migrations
packages/engine     Deterministic analysis engine — facts, relations, journeys, digest, checks
packages/ai         Insea client, review pipeline (map → read × N → dig → synthesize), linker,
                    What-If chat
packages/fc-lang    Vendored fc-format-v4 toolchain for `.fcc`/`.fcg` (v0.4.0)
docs                Insea integration, prompt-pass contracts, deterministic checks reference
```

Each app/package has its own README covering purpose, extension points and testing.

## How it works

One monorepo, two processes at runtime: the **web SPA** (Vite + React 19 + TanStack + Tailwind)
talks HTTP/JSON to the **Hono API server** (git · fs · sqlite), and both sides parse every payload
through `packages/contracts` (Zod), so the wire shape can never drift silently.

A review run starts from a deterministic **digest** (change facts, linked journeys, engine
findings, context — plus an anchor registry) and drives the Insea pipeline: `map` (theme partition
over engine-issued file ids) → `read` × N reading units → optional `dig` → `synthesize`, with the
linker gating every pass boundary and repair rounds for schema drift. Results, verification stats
and per-pass manifests persist to SQLite; SSE relays per-unit progress to the UI.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for topology, runtime flows, invariants and extension
recipes.

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

Correctness is additionally gated by checked-in corpora and eval suites:

- the 245-file fc-lang corpus — every file must parse, format, reparse and keep its semantic
  fingerprint;
- the engine hardening gate (`packages/engine/test/eval.test.ts`) — 20 injected defects must each
  surface as their owning check, and 4 clean cases (including the unchanged checked-in 31-file
  Sample CSV corpus) must yield zero findings.

## Documentation map

| Document | Contents |
| --- | --- |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Topology, runtime flows, invariants, extension recipes, epoch map |
| [`docs/INSEA.md`](./docs/INSEA.md) | Insea wire contract, response salvage, failure semantics |
| [`docs/PROMPTS.md`](./docs/PROMPTS.md) | Prompt passes, shared rules, linker guards |
| [`docs/CHECKS.md`](./docs/CHECKS.md) | Check catalogue, pins, reader profile, silent-skip surface |
| `apps/*` / `packages/*` READMEs | Per-package purpose, extension points, commands |

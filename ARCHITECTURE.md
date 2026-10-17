# Architecture

How Craftland QA is put together, which rules are load-bearing, and where to plug in new work.
Keep this file current whenever a boundary or invariant changes.

## 1. Purpose and principles

Craftland QA compares two git refs of a Craftland Studio project (A/B) and explains what changed,
with emphasis on **configuration ↔ code mismatches** that silently break games at runtime.

Principles that shape every design decision:

- **Universal engine.** The only assumptions are: the FC language grammar, the CSV file format, and
  git. Project conventions (enum indices, loop styles, guard clauses…) are *observed* as data and
  surfaced as suggestions the user can pin — never baked in as engine behavior.
- **Parse, don't guess.** Facts come from parsers (AST, CSV) — marked `exact`, `inferred` or
  `unknown`. Only `exact` relations may create hard findings; `inferred` only routes context;
  `unknown` is reported honestly ("chưa liên kết được") and invites a pin.
- **Evidence or it didn't happen.** Every AI claim must carry evidence-anchor IDs; a verifier strips
  unanchored claims. The LLM is never a source of facts.
- **Local-first & read-only.** The server reads local repositories and never writes to them.
  AI calls (E4+) send digested context only, from an explicit user action.

## 2. Topology

One monorepo, two processes at runtime:

```
┌──────────────────────────┐        /api (HTTP, JSON)        ┌───────────────────────────┐
│ apps/web — Vite SPA      │ ──────────────────────────────▶ │ apps/server — Hono        │
│ React 19 · TanStack      │ ◀────────────────────────────── │ tsx (dev) / node (prod)   │
│ Router+Query · Tailwind  │        error envelope           │ git · fs · sqlite (sync)  │
└──────────────────────────┘                                 └───────────────────────────┘
             both sides validate every payload through packages/contracts (Zod)
```

- **Separate API process** because analysis work is long-running, file-system-bound and (later)
  streams progress; the SPA stays a pure client and can be developed against a running server.
- **Shared contracts package** because neither side may invent its own wire shape — schemas are the
  single source of truth, and both sides *parse* payloads instead of casting them.
- **Synchronous SQLite (`node:sqlite`)** deliberately: single-user local tool, zero native
  dependencies (see plan decision #23; `better-sqlite3` was rejected — no Node 24 prebuilt).

## 3. Runtime flows

### Boot (server)

`index.ts` → `env.ts` (loads `.env` if present) → `config.ts` (validate; throws on bad PORT) →
`logger.ts` (pino) → `db/client.ts` `openDatabase()` + `migrateDatabase()` → `app.ts` `createApp()` →
`@hono/node-server` `serve()`; SIGINT/SIGTERM close the listener.

### Request lifecycle

1. Hono middleware logs `{method, path, status, durationMs}` after completion.
2. Route handler resolves services (`projects.ts`, `git.ts`, routes' FS helpers).
3. Services throw `AppError(code, message)` for anything expected (guards, missing rows, git errors);
   everything else is a bug and becomes a logged 500.
4. **Success bodies are parsed through their contract schema before leaving** — server and contracts
   can never drift silently.
5. Errors leave as the shared envelope `{ error: { code, message, details? } }`; `details` is
   engineer-facing and never rendered raw in the UI.

### Web data flow

`lib/api.ts` `fetchJson()` is the **only** request helper: it understands the error envelope, turns
everything into `AppError`, and normalizes transport failures (server down) into a friendly localized
message. Hooks in `lib/use-*.ts` wrap react-query, parse responses through contracts and define the
query keys. `contexts/project-context.tsx` owns the active project (persisted by id; falls back to
the first project when the stored id disappears).

Query key conventions: `["projects"]`, `["projects", id, "refs"]`,
`["projects", id, "diff-summary", base, current]`, `["projects", id, "digest", base, current]`,
`["fs", path]`, `["reviews", …]`, `["whatif", …]`. Mutations invalidate `["projects"]` /
`["reviews"]` / `["whatif"]`.

### Review run (server + AI)

1. `POST /api/reviews` inserts a `runs` row (`running`) and returns `202 { runId }` immediately —
   the pipeline runs in the background, driven by `src/reviews.ts` (`ReviewManager`).
2. The manager loads the digest (shared `digest-input.ts`), then runs `runReviewPipeline` (v2,
   decision #28): `map` (file-id partition) → `read` × N reading units → **L1** coverage re-reads
   → one `dig` round → `synthesize` → **L3** verify→revise, with the linker on every boundary and
   repair rounds for schema drift (map/read/dig/synthesize). Progress relays as SSE events
   through the run's channel (replay buffer + live subscribers; `unit`/`units`/`round` on stage
   events; the channel closes after the terminal event).
3. Result, verification stats and per-pass manifests persist to `runs` + `contextManifests`.
   Cancel aborts in-flight calls via `AbortController` and persists `cancelled`. AI failure falls
   back to the deterministic report (run still `completed`, carrying `fallbackReason`).
4. The web starts runs from Compare, navigates to `/runs/$runId`, consumes the SSE stream (with
   2 s polling as a converging fallback) and renders report v2: the theme change map
   (`themes` persisted with the run — engine-validated partition; AI names/narratives labelled
   interpretation) over the raw change facts, the findings tab split FACT (engine checks) /
   INTERPRETATION (linked AI findings, unverified ones labelled "Cần xác minh" and sorted
   last), and the AI notes tab with the audit trail.

### What-If chat (server + AI)

1. Sessions and pins are scoped to a **comparison** (`projectId + baseRef + currentRef`), not to a
   run: `sessions.base_ref/current_ref` plus the `pins` table; every turn persists as a `turns`
   row and the ledger is written back to `session_ledgers` (mechanically composed from previous
   answers — no summarization call).
2. `POST /api/whatif/sessions/:id/ask` inserts the user turn + a pending assistant turn, then runs
   the turn in the background (`WhatIfManager`, the shared `SseChannel` replay semantics): load the
   digest → build context (task pack, ledger, recent turns, pins, a 400-anchor evidence pack with
   pinned anchors boosted, and the latest verified run report of the same pair when one exists) →
   one `whatif` call → `linkAnswer` → persist (`turns` + `context_manifests` with `turnId`) → emit
   the answer over SSE. AI failure persists an honest error on the turn — never a fake answer.
3. Entry points: the What-If page (scope picker + session list + chat) and the "Hỏi về thay đổi
   này" button on a run. Answers render evidence chips (click → evidence dialog, 📌 pin) / labelled
   speculation / unknowns with a transparency line ("ngữ cảnh: X dẫn chứng · Y ghim · N lượt").

## 4. Package map and dependency rules

| Package | Responsibility | May import |
| --- | --- | --- |
| `packages/contracts` | Wire DTOs, error envelope, versions | nothing (leaf) |
| `packages/db` | Drizzle schema + client + migrations | contracts |
| `packages/fc-lang` | Vendored FC language toolchain (lexer/AST) | nothing |
| `packages/engine` | Deterministic facts/relations/checks (E2+) | contracts, fc-lang |
| `packages/ai` | Insea client, passes, verifier (E4+) | contracts |
| `apps/server` | HTTP surface + orchestration | contracts, db, engine, ai |
| `apps/web` | Designer UI | contracts only |

`apps/web` never imports `db`/`engine`/`server` — it talks HTTP only.

## 5. Invariants (do not weaken)

- **Git is read-only.** `apps/server/src/git.ts` uses `execFile` with array args (never a shell) and
  only non-mutating commands. Before any diff, refs resolve via `rev-parse --verify <ref>^{commit}`
  so a ref string can never reach git as a flag. `WORKTREE` is a pseudo-ref valid only as the
  *current* side; the base must be a real commit.
- **Path guards.** A project path must be absolute, exist, be a directory, and not be a drive root
  or the user home directory (`apps/server/src/paths.ts`). These are accident guards, not a
  permissions boundary — project registration is fully manual (no detection, no allowed-roots;
  see plan decision #24).
- **Parse at both boundaries.** Server parses responses it sends; web parses responses it receives.
  A schema failure is a bug and must fail loudly in development.
- **Error model.** Expected failures are `AppError` with a stable code and HTTP status; the codes
  are the only thing clients branch on — messages are for humans. Never swallow errors silently.
- **Determinism.** Engine code takes no clocks/randomness. Same inputs + version ⇒ same output.

## 6. Extension recipes

### Add an API endpoint

1. Define request/response schemas in `packages/contracts/src/<feature>.ts` (field-level TSDoc);
   export from the index.
2. Implement a service module in `apps/server/src/` (pure logic, `AppError` for failures).
3. Add the route in `apps/server/src/routes/*.routes.ts`, parse the response schema, and add HTTP
   tests against real temp folders/repos (pattern: `apps/server/test/projects.test.ts`).
4. Call it from the web through a typed hook in `apps/web/src/lib/` using `fetchJson`.
5. Update this file's flows section if a boundary changed; bump `API_VERSION` for breaking shapes.

### Add a page or feature to the web app

1. Page in `apps/web/src/pages/`, route in `router.tsx`, nav entry in `components/app-shell.tsx`.
2. All user-facing strings go through i18n (`src/i18n/index.ts`, Vietnamese keys) — no literals.
3. Data via react-query hooks only; loading/empty/error states are part of the feature, not an
   afterthought. Un-built features get a `PhaseBadge`, never fake data.
4. Respect the layout rules: header keeps exactly two icon actions (search, What-If); theme and
   density are set in Settings or the command palette.

### Add an engine check (E2+)

Checks plug in through the extension contracts planned in `packages/engine` (check/adapter/pass
templates). A check must: declare which facts it consumes, emit findings with severity +
confidence + evidence anchors, and stay deterministic. See `packages/engine/README.md`.

## 7. Data model and migrations

`packages/db/src/schema.ts` currently holds the full planned table set: `projects` is live; the
remaining tables (facts, runs, findings, pins, sessions…) are reserved so migrations stay linear
across phases. Workflow: edit schema → `pnpm db:generate` → commit schema + generated SQL/journal.
Tests use `openDatabase(":memory:")` + `migrateDatabase()`.

## 8. Documentation map

| Change | Update |
| --- | --- |
| Wire shape / error codes | `packages/contracts/README.md`, `API_VERSION` |
| Server modules / git rules | `apps/server/README.md` + this file's invariants |
| UI structure / design rules | `apps/web/README.md` |
| Engine scope / determinism | `packages/engine/README.md` |
| Insea wire contract / failure semantics | `docs/INSEA.md` |
| Prompt passes / guards | `docs/PROMPTS.md` |
| Product-level overview | root `README.md` |

## 9. Roadmap pointer

Six phases (see the locked master plan): **1** knowledge core + AI review (E0–E5, current) →
**2** What-If + memory (E6) → **3** deep CSV facts (E7) → **4** semantic layer + silent-skip
surface (E8) → **5** localization, attribution, recompute, export (E9–E10) → **6** hardening &
packaging (E11).

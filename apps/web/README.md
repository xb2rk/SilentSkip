# apps/web

The designer-facing SPA (Vite + React 19 + TanStack Router/Query + Tailwind v4 + shadcn-style
primitives). The UI language is Vietnamese and fully i18n-keyed; technical docs are English.

## Structure

| Path | Responsibility |
| --- | --- |
| `src/pages/` | Route screens (Overview, Compare, What-If, History, Tools, Status, Settings, run report) |
| `src/components/report/` | Report UI (change facts, finding cards, evidence dialog) |
| `src/components/` | Feature components (`projects/…`) + shell (sidebar, palette, header) |
| `src/components/ui/` | shadcn primitives (generated; keep as-is unless a bug demands a fix) |
| `src/contexts/` | `theme-context` (theme/density/language), `project-context` (active project) |
| `src/lib/` | `api.ts` (the only fetch helper), react-query hooks, preference utilities |
| `src/i18n/index.ts` | All user-facing strings (Vietnamese default) |

## Rules

- **All requests go through `lib/api.ts` `fetchJson`** (envelope-aware, localized transport
  errors). Hooks in `lib/use-*.ts` wrap react-query, parse through `packages/contracts` and own
  the query keys (`["projects"]`, `["projects", id, "refs"]`, `["projects", id, "diff-summary",
  base, current]`, `["projects", id, "digest", base, current]`, `["fs", path]`, `["reviews", …]`;
  mutations invalidate `["projects"]` / `["reviews"]`).
- **No hard-coded user strings** — every label/placeholder/error goes through i18n keys.
- **Preferences are no-FOUC**: theme/density are applied by a tiny pre-hydration script in
  `index.html` whose storage keys must stay in sync with `lib/theme.ts` / `lib/density.ts`.
- **Layout invariants**: the header keeps exactly two icon actions (Ctrl+K search, What-If) — the
  theme control lives in Settings/command palette; the status pill appears only on error.
- **No fake data**: unshipped features render disabled + `PhaseBadge`, never mocked results.

## Adding a page

1. `src/pages/<name>-page.tsx` with a TSDoc explaining its job.
2. Route in `src/router.tsx`; nav entry in `components/app-shell.tsx` if it belongs in the sidebar.
3. All strings as new keys in `src/i18n/index.ts`; hook up data via a `lib/use-*.ts` hook.

## Commands

```sh
pnpm --filter @silentskip/web dev        # Vite on http://127.0.0.1:5173 (proxies /api)
pnpm --filter @silentskip/web build      # production bundle
pnpm --filter @silentskip/web typecheck  # tsc --noEmit
```

The dev server binds `127.0.0.1` explicitly (Windows `localhost` may resolve to `::1`).

# apps/server

The Hono API server: HTTP surface, read-only git access, filesystem browsing and the project
registry. The web app never touches the disk — everything local goes through this process.

## Module map

| Module | Responsibility |
| --- | --- |
| `src/index.ts` | Boot: env → config → logger → db (open + migrate) → app → serve; graceful shutdown |
| `src/env.ts` | Side-effect module: loads repo-root then `apps/server/.env` (Node built-in loader, no dotenv) |
| `src/config.ts` | Validated boot configuration (`ServerConfig`, `loadConfig`) |
| `src/logger.ts` | pino instance per config |
| `src/app.ts` | Wiring + request logging middleware + `/api/health` + error envelope handling |
| `src/routes/projects.routes.ts` | Project CRUD-ish endpoints, refs, diff summary |
| `src/routes/fs.routes.ts` | `GET /api/fs/list` — one-level folder browsing for the picker |
| `src/routes/utils.ts` | `readJsonBody()` — schema-parsed JSON bodies |
| `src/projects.ts` | Registry service (add/list/get/remove) over `packages/db` |
| `src/git.ts` | Read-only git service (head, refs, diff summary) |
| `src/paths.ts` | Path normalization + registration guards |

## API surface (E1)

| Endpoint | Notes |
| --- | --- |
| `GET /api/health` | uptime, DB probe, literal versions |
| `GET /api/projects` | newest first |
| `POST /api/projects` | `{ rootPath, name? }` — manual registration, protective guards only |
| `DELETE /api/projects/:id` | 204; cascades derived rows |
| `GET /api/projects/:id/refs` | head + dirty + branches/remotes/tags |
| `GET /api/projects/:id/diff-summary?base=&current=` | `current=WORKTREE` diffs against disk incl. untracked |
| `GET /api/fs/list[?path=]` | one directory level; no path ⇒ drive roots |

## Invariants (see also ARCHITECTURE.md §5)

- **Git is strictly read-only**: `execFile` with array args (never a shell); refs are resolved
  through `rev-parse --verify <ref>^{commit}` before any diff so a ref cannot smuggle a flag.
- **Guards, not permissions**: a project path must be absolute, existing, a directory, and not a
  drive root or the user home. No allowed-roots list, no project detection (plan decision #24).
- **Success bodies parse through their contract schema before leaving** — drift fails loudly.
- **Expected failures are `AppError`** with a stable code; everything else is a logged 500 with an
  internals-free envelope.

## Adding an endpoint

1. Contracts first: schemas in `packages/contracts/src/<feature>.ts`.
2. Service function (pure, `AppError` on failure).
3. Route in `src/routes/`; parse the response schema; register in `app.ts`.
4. Test it in `test/` against real temp folders/repos (see `projects.test.ts` pattern).

## Commands

```sh
pnpm --filter @craftland-qa/server dev     # tsx watch on :3000
pnpm --filter @craftland-qa/server test    # vitest (real git repos in temp dirs, :memory: sqlite)
pnpm --filter @craftland-qa/server build   # tsc emit (packaging path)
```

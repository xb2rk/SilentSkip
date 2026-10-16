# @craftland-qa/contracts

Single source of truth for every payload that crosses the HTTP boundary. Both the server and the
web app parse data through these Zod schemas — the types they use are always `z.infer` aliases of
the schemas, never hand-written duplicates.

## What lives here

| File | Contents |
| --- | --- |
| `error.ts` | `ErrorCodes`, `AppError` (code + status + envelope), `ErrorEnvelopeSchema` |
| `version.ts` | `PRODUCT_VERSION` (UI footer) and `API_VERSION` (bumped on breaking wire changes) |
| `health.ts` | `/api/health` payload with literal versions so drift fails loudly |
| `project.ts` | Project registry DTOs (`ProjectSummary`, list, add request) |
| `git.ts` | A/B contracts: refs, head, `WORKTREE_REF` pseudo-ref, diff summary |
| `fs.ts` | Folder-picker contracts (`GET /api/fs/list`) |

## Rules

- **Schemas are the documentation.** Each schema carries TSDoc explaining purpose and invariants.
  The `z.infer` type aliases intentionally carry no separate TSDoc — they inherit the schema's
  meaning; duplicating it mechanically would rot.
- **Parse at both boundaries.** The server parses success bodies before sending; the web parses
  them before using. A schema rejection is a bug, not a runtime condition.
- **Error envelope only.** Non-2xx responses are always `{ error: { code, message, details? } }`.
  Clients branch on `code`; `message` is human-facing Vietnamese; `details` is engineer-only.

## Extending

1. Add a `<feature>.ts` file with request/response schemas (+ field TSDoc where non-obvious).
2. Export it from `index.ts` (alphabetical).
3. Bump `API_VERSION` for breaking shape changes.

## Testing

`pnpm --filter @craftland-qa/contracts test` — schema smoke tests live in `test/`.

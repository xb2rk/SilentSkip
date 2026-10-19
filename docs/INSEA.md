# Insea workflow integration

How SilentSkip talks to the Insea workflow engine (workflow `25537`). The client lives in
`packages/ai/src/insea/`; the server config exposes it as `config.ai`.

## Wire contract

- `POST` `multipart/form-data` with bearer auth (`Authorization: Bearer <key>`).
- Fields: `Prompt` (text), `Manifest` (JSON string), and repeated `DataList` file parts.
- The endpoint rejects an empty attachment set, so when there is nothing to attach the client
  sends the manifest itself as a `manifest.json` part.
- **Stateless single-shot**: every pass re-sends everything it needs. Continuity across passes
  (and later across What-If turns) comes from our own manifests and ledger, never from
  server-side memory.

## Response handling

- Envelope shapes seen in the wild: `{data:{outputs:{result}}}`, `{outputs:{result}}`,
  `{output:{…}}`, `{output:"…"}`, `{result:"…"}`. The unwrapper accepts all of them.
- The result is usually a JSON **string**; the salvage ladder extracts the object:
  strip reasoning tags → direct parse → first markdown fence → outermost braces → text fallback
  (`{executiveSummary}`). The rung used (`clean | stripped | fence | braces | text-fallback`) is
  always reported and persisted per pass — salvage is never silent.

## Failure semantics

| Code | Meaning | Behaviour |
| --- | --- | --- |
| `not-configured` | URL or key missing | deterministic fallback report (run still `completed`) |
| `http-error` | non-2xx / non-JSON body | run fails or falls back, with a 500-char body preview |
| `timeout` | `AI_WORKFLOW_TIMEOUT_MS` exceeded (default 180s) | fallback report |
| `cancelled` | user pressed Cancel | run persists as `cancelled` |
| `network` | transport error | fallback report |
| `invalid-output` | model answered but failed schema validation | never silently accepted |

A run never fails flakily: AI unavailability produces the deterministic fallback report
(`buildFallbackReport`) persisted as a normal `completed` run carrying `fallbackReason`.

## Result cache

Successful calls are stored in `pass_cache` (SQLite) and keyed by a sha-256 over everything the
model saw for that call — prompt, manifest, attachment names and bytes. A later call with identical
inputs is answered from the row instead of the network (`cached: true`, `latencyMs: 0`); errors are
never cached, and a cache fault falls through to a live call. This is what makes "Chạy lại" a resume
after a timeout or an interruption: finished passes replay, the unfinished one is retried.

Because the key is content, a workflow that changes **behind the same URL** (a model swap on the
Insea side) can replay an answer that no longer matches it. Escape hatches, in order of preference:
bump the pass prompt version (changes the prompt, hence the key), or clear the `pass_cache` table.
`AI_PASS_CACHE=off` disables the cache entirely for a run.

## Configuration & probes

`AI_WORKFLOW_URL`, `AI_WORKFLOW_API_KEY`, `AI_WORKFLOW_TIMEOUT_MS`, `AI_READ_CONCURRENCY` — repo-root
`.env` (gitignored). Probes:

```sh
pnpm --filter @silentskip/ai canary                       # strict-JSON canary, latency + salvage
pnpm --filter @silentskip/ai canary -- --parallel 3       # 3 simultaneous calls: does it tolerate them?
pnpm --filter @silentskip/ai payload:probe <projectId> <base> <current>  # real payload cost, per variant
pnpm --filter @silentskip/ai review:once <projectId> <base> <current>   # full pipeline (server must be up)
```

`--parallel <n>` fires `n` probes at once and reports per-slot latency/errors plus the batch wall
time. Measured 2026-10-19 (project 25537, ~200-byte canary payload): `n=3` → 2.2 s wall for 6.4 s of
latency (2.8x), `n=6` → 3.3 s for 16.5 s (5.0x), no errors in either. That proves the endpoint
**accepts** concurrent calls; it does **not** prove a speedup on real payloads. A real 72-file run
was no faster at K=3 than at K=1 (1152 s vs 1070 s) with per-call latency inflated 2-8x, so
`AI_READ_CONCURRENCY` defaults to 1 — measure with `payload:probe` (real bytes) before raising it.

# Insea workflow integration

How Craftland QA talks to the Insea workflow engine (workflow `25537`). The client lives in
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

## Configuration & probes

`AI_WORKFLOW_URL`, `AI_WORKFLOW_API_KEY`, `AI_WORKFLOW_TIMEOUT_MS` — repo-root `.env`
(gitignored). Probes:

```sh
pnpm --filter @craftland-qa/ai canary                       # strict-JSON canary, latency + salvage
pnpm --filter @craftland-qa/ai review:once <projectId> <base> <current>   # full pipeline (server must be up)
```

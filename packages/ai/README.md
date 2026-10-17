# @craftland-qa/ai

The AI review pipeline (Insea): workflow client, context assembly, the pass library
(`digest_read → [dig] → synthesize`, `whatif_answer`) and the mandatory citation verifier.

## Landed

- **Insea client (E4.1)** — `runInseaWorkflow(request)`: stateless single-shot multipart
  (`Prompt` + `Manifest` + repeated `DataList`; the endpoint requires ≥1 attachment, so an empty
  list attaches the manifest itself), bearer auth, timeout and user-cancel distinguished
  (`timeout` vs `cancelled`), envelope unwrap and a five-rung JSON salvage ladder
  (`clean`/`stripped`/`fence`/`braces`/`text-fallback`) — the rung is reported, never hidden.
  Failures are `AiError` with a stable code (`not-configured`, `http-error`, `timeout`,
  `cancelled`, `network`) and a short body preview.
- **Canary probe (E4.1)** — `canaryProbe(config)`: one tiny round-trip that exercises multipart,
  auth, unwrap and salvage; `ok: true` only when the model honours the JSON contract. Run it for
  real with `pnpm --filter @craftland-qa/ai canary` (reads the repo-root `.env`). Last verified
  against Insea project 25537: ok, ~1.8s, salvage `clean` (2026-10-17).

## Planned scope

- **Passes**: `digest_read → [dig] → synthesize` with a versioned prompt registry
  (`docs/PROMPTS.md`, golden snapshots in tests).
- **Citation verifier (mandatory)**: every claim must reference evidence-anchor IDs from the
  context manifest; unanchored claims are stripped and counted (stats surface in the UI).
- **Deterministic fallback**: when the model times out or fails verification, the deterministic
  engine output is presented instead — the UI never depends on a flaky call.

## Hard rules

- The LLM is **never a fact source**: it reads digests, writes prose, and cites anchors. Facts
  come from `packages/engine`.
- No user project content leaves the machine except the digested context the user explicitly ran.
- Prompts live in the registry, not inline in code; changes get snapshot tests.

## Commands

```sh
pnpm --filter @craftland-qa/ai test      # offline: fetch is mocked
pnpm --filter @craftland-qa/ai canary    # real round-trip against the configured workflow
```

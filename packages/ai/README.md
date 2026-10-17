# @craftland-qa/ai

The AI review pipeline (Insea): workflow client, context assembly, the v2 pass flow
(`map → read×N → [dig] → synthesize`, decision #28) and the linker that gates every citation.

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
- **Pass library + review pipeline (E4.2)** — versioned prompt registry (`digest_read` / `dig` /
  `synthesize` at 1.0.0, shared anti-hallucination rules, snapshot-tested); context assembly
  (`task.json`, `changes.json`, `journeys.json`, `context.json` + `anchors.jsonl`) under a hard
  evidence budget (600 anchors / 1.8 MB) with tiered priority (changed values → row structure →
  removals → additions → journeys), per-file spread and an honest dropped-count note; strict output
  schemas
  (model drift → `AiError` `invalid-output`, never silent); `dig` resolves `needMore` queries
  deterministically (substring match against the full anchor registry → ≤40 focused anchors,
  exactly one round); `mergeReadOutputs`
  dedupes and ranks by severity; `runReviewPipeline` wires it all together. Real run (Sample
  `e96f6ff→418d7d6f`): 3 passes, 28s, salvage `clean`, verdict `needs_review` 88/100, 4 findings /
  7 unknowns / 3 answers — and the dig pass honestly reported its 3 unanswered queries.
- **Citation verifier (E4.3)** — deterministic and model-independent; runs on every pass boundary
  inside `runReviewPipeline`. Checks per finding: cited anchor ids exist in the **full digest
  registry** (the evidence pack is attention economy, the digest is the authority); `synthesize`
  may not introduce anchors earlier passes never verified; zero surviving anchors removes the
  finding (and an all-stripped report is forced to `insufficient_evidence`); every number must
  trace to engine metrics, the goal, or the cited snippets (token boundaries — `75` does not pass
  as `0.75`); quoted fragments must appear in the cited snippets. Nothing is silent: every strip
  and downgrade emits a `VerifyIssue` and moves a counter in `PipelineVerification`. Real run
  (Sample `e96f6ff→418d7d6f`): the read pass stripped 3 truly unknown ids and honestly downgraded 3
  findings; synthesize introduced 0 new anchors and stripped 0.
- **Fallback + progress events (E4.4)** — `buildFallbackReport(digest, error)`: when the AI is
  unavailable (any `AiError` except cancellation) the run still completes with an honest
  `insufficient_evidence` report summarising the change from engine stats — the UI never depends
  on a flaky call. `runReviewPipeline` takes an optional `onEvent` hook and emits stage
  started/completed around every pass; the server relays these over SSE.
- **AI flow v2 (E7.2, decision #28)** — the single-shot digest read is gone. `map` refines the
  engine's mechanical partition into themes (set-equality validated — every changed file exactly
  once); `read` runs **once per reading unit, every run** (lossless units from `plan/`, ~60 KB
  each) with `facts.json` giving each unit its fact-store slice; **L1** re-reads units that
  produced no signal or whose engine findings were never cited (≤2 rounds), and whatever stays
  unread lands in `unknowns`; `dig` remains one focused round; **L3** re-runs `synthesize` with
  linker issues as constraints (≤2 rounds). The **fact index + linker**
  (`src/facts/fact-index.ts`, `src/link/`) replaced the verifier: numbers travel only as
  `{{f:<factId>}}` placeholders the renderer fills from engine quantities; structural comparisons
  are typed claims the engine evaluates (a false claim kills its finding — the "17 vs 11 columns"
  false-positive class is mechanically impossible); free digits outside facts/literals are
  rejected; anchors resolve against the full registry; quotes must sit in cited snippets. SSE now
  reports per-unit progress (`unit`/`units`/`round` on stage events).

## Planned scope

- **Engine checks in the report (E7.3)** and **Report v2 (E7.4)** — STRUCT/TYPE/DANGLING findings
  rendered as the FACT layer; AI prose as INTERPRETATION, with the "Cần xác minh" label for
  unknown-confidence findings.
- **What-If passes (E6)**: `whatif_answer` plus session-ledger context assembly, on top of the
  same linker and manifest discipline.

## Hard rules

- The LLM is **never a fact source**: it reads digests, writes prose, and cites anchors. Facts
  come from `packages/engine`.
- No user project content leaves the machine except the digested context the user explicitly ran.
- Numbers travel as `{{f:<factId>}}` placeholders and structural comparisons as typed claims
  (decision #28) — the linker rejects everything else; free digits have no path into a report.
- Prompts live in the registry, not inline in code; changes get snapshot tests.

## Commands

```sh
pnpm --filter @craftland-qa/ai test      # offline: fetch is mocked
pnpm --filter @craftland-qa/ai canary    # real round-trip against the configured workflow
pnpm --filter @craftland-qa/ai review:once <projectId> <base> <current>  # real pipeline (dev server must be up)
```

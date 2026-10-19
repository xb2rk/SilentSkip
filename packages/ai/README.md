# @silentskip/ai

The AI review pipeline (Insea): workflow client, context assembly, the v2 pass flow
(`map → read×N → [dig] → synthesize`, decision #28), the What-If chat (`whatif`, E6) and the
linker that gates every citation.

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
  real with `pnpm --filter @silentskip/ai canary` (reads the repo-root `.env`); `canaryParallelProbe`
  (`--parallel <n>`) fires n calls at once and reports per-slot outcomes plus the batch wall time.
  The ~200-byte canary payload only proves the endpoint **accepts** concurrency, not that it pays:
  with real payloads 3 overlapping reads took as long as 3 sequential ones and each call inflated up
  to 8x, so `AI_READ_CONCURRENCY` defaults to 1. Last verified against Insea project 25537: ok,
  ~1.8s, salvage `clean` (2026-10-17).
- **Pass library + review pipeline (E4.2)** — versioned prompt registry (`digest_read` / `dig` /
  `synthesize` at 1.0.0, shared anti-hallucination rules, snapshot-tested); context assembly
  (`task.json`, `changes.json`, `journeys.json`, `context.json` + `anchors.jsonl`) under a hard
  evidence budget (600 anchors / 1.8 MB) with tiered priority (changed values → row structure →
  removals → additions → journeys), per-file spread and an honest dropped-count note; strict output
  schemas
  (model drift → `AiError` `invalid-output`, never silent); `dig` resolves `needMore` queries
  deterministically (substring match against the full anchor registry → ≤40 focused anchors,
  exactly one round); `mergeReadOutputs`
  dedupes and ranks by severity; `runReviewPipeline` wires it all together. Real run (sample
  project): 3 passes, 28s, salvage `clean`, verdict `needs_review` 88/100, 4 findings /
  7 unknowns / 3 answers — and the dig pass honestly reported its 3 unanswered queries.
- **Citation verifier (E4.3)** — deterministic and model-independent; runs on every pass boundary
  inside `runReviewPipeline`. Checks per finding: cited anchor ids exist in the **full digest
  registry** (the evidence pack is attention economy, the digest is the authority); `synthesize`
  may not introduce anchors earlier passes never verified; zero surviving anchors removes the
  finding (and an all-stripped report is forced to `insufficient_evidence`); every number must
  trace to engine metrics, the goal, or the cited snippets (token boundaries — `75` does not pass
  as `0.75`); quoted fragments must appear in the cited snippets. Nothing is silent: every strip
  and downgrade emits a `VerifyIssue` and moves a counter in `PipelineVerification`. Real run
  (sample project): the read pass stripped 3 truly unknown ids and honestly downgraded 3
  findings; synthesize introduced 0 new anchors and stripped 0.
- **Fallback + progress events (E4.4)** — `buildFallbackReport(digest, error)`: when the AI is
  unavailable (any `AiError` except cancellation) the run still completes with an honest
  `insufficient_evidence` report summarising the change from engine stats — the UI never depends
  on a flaky call. `runReviewPipeline` takes an optional `onEvent` hook and emits stage
  started/completed around every pass; the server relays these over SSE.
- **AI flow v2 (E7.2/E7.2.1, decision #28)** — the single-shot digest read is gone. `map` picks
  **engine-issued file ids** (`f1…fN` from `skeleton.json`) into themes — the model never writes
  a path, so invented directories are mechanically impossible; set-equality validated, ≤2 repair
  rounds, and the engine base partition as last-resort fallback (`map-invalid` issue + honest
  unknown) so one bad map can never kill a run; `read` runs **once per reading unit, every run**
  (lossless units from `plan/`, ~60 KB
  each) with `facts.json` giving each unit its fact-store slice; units are read through a **bounded pool** (`AI_READ_CONCURRENCY`, default 1 —
  this endpoint queues overlapping calls instead of speeding them up) folded in unit order, so pool size cannot change
  the report; **L1** re-reads only units
  whose call never answered, plus units owning an engine finding no reading has cited (≤2 rounds), and whatever stays
  unread lands in `unknowns`; `dig` remains one focused round; **L3** re-runs `synthesize` with
  linker issues as constraints (≤2 rounds); a schema-invalid reply is a repairable round too
  (`synthesize-invalid`), so one bad writer reply cannot kill the run. The **fact index + linker**
  (`src/facts/fact-index.ts`, `src/link/`) replaced the verifier: numbers travel only as
  `{{f:<factId>}}` placeholders the renderer fills from engine quantities; structural comparisons
  are typed claims the engine evaluates (a false claim kills its finding — the "17 vs 11 columns"
  false-positive class is mechanically impossible); free digits outside facts/literals are
  rejected; anchors resolve against the full registry; quotes must sit in cited snippets. SSE now
  reports per-unit progress (`unit`/`units`/`round` on stage events).

- **Report v2 (E7.4)** — the run's engine-validated `themes` (id/name/files) persist with the
  result (`ReviewRunResultSchema.themes`, `[]` for legacy/fallback runs); the run page opens on
  a **theme change map** over the raw facts, findings split FACT (engine) / INTERPRETATION
  (linked AI, "Cần xác minh" for unknown confidence, sorted last), with per-unit/per-round
  progress in the live view.

- **Report depth (E7.5, decision #28)** — every `read` call now receives `bodies.jsonl` (the
  function bodies of added/changed functions — behaviour first), file-balanced snippet anchors
  (≤40 per file) and, for oversized units, one call per **chunk** (`chunk`/`chunks` on stage
  events). New deterministic checks feed the FACT layer: `CALL-ARITY-01` (major/`exact` —
  call-site arity drift after signature changes) and `ORPHAN-ADD-01` (info/`exact` — added
  function nothing references). Theme narratives are structured
  (`summary`/`behaviorChange`/`watchFor` + linker-validated `anchorIds`) — read and synthesize
  prompts at 2.2.0. On the 72-file refactor range: 63 report findings (was 13) including the
  call-arity drift and named treatments of the new special-enemy and stat-service systems;
  229 anchors verified, hallucinated ids stripped honestly.

- **What-If chat (E6, decision #28)** — the `whatif` pass (1.0.3) answers one question per turn over
  the same machinery. Insea is stateless, so every call **reconstructs context**: task pack, the
  session ledger (mechanically composed from previous answers — no summarization call), recent raw
  turns, pins, and a 400-anchor evidence pack with **pinned anchors boosted to the front**, plus the
  latest verified run report of the same comparison when one exists. `linkAnswer` gates the answer
  like every other pass: evidence statements must cite registry anchors (unanchored → demoted to
  speculation, never dropped silently), numbers only via `{{f:<factId>}}` placeholders, free digits
  in prose get an honest "no fact source" suffix. Sessions and pins are scoped to **one A/B
  comparison** (not a run) and survive new runs of the same pair; answers are in Vietnamese with
  evidence / speculation / unknowns blocks and a transparency line (ngữ cảnh: X dẫn chứng · Y ghim ·
  N lượt). Every turn persists (`turns` + `context_manifests.turnId`) and streams over SSE with
  replay. Real smoke (sample refactor range, 2 turns): grounded Vietnamese answer citing
  `SpecialUnitData.fcg:159`; follow-up carried `turns=1` + `pins=1` in its context and answered the
  spawn-flow question coherently.

- **Honest engine effects (E8.2d)** — engine findings carry `effectConfidence` next to
  `confidence` (observation vs runtime consequence). Shared prompt rules now require inferred or
  unknown effects to be phrased as possibilities, never facts; all pass versions bumped by one
  patch (map 2.1.1, read 2.2.1, dig 2.0.1, synthesize 2.2.1, whatif 1.0.1).

## Planned scope

- **LOC-01 (E9)** shipped in the engine (shape-detected localization tables, exact multiset
  placeholders) together with the localization report page, git attribution, and the two-run
  history compare; the eval fixture set lands at E11. The E8 semantic checks and silent-skip surface
  are shipped, and surfaces stay outside the prompts.

## Hard rules

- The LLM is **never a fact source**: it reads digests, writes prose, and cites anchors. Facts
  come from `packages/engine`.
- No user project content leaves the machine except the digested context the user explicitly ran.
- Numbers travel as `{{f:<factId>}}` placeholders and structural comparisons as typed claims
  (decision #28) — the linker rejects everything else; free digits have no path into a report.
- Prompts live in the registry, not inline in code; changes get snapshot tests.

## Commands

```sh
pnpm --filter @silentskip/ai test      # offline: fetch is mocked
pnpm --filter @silentskip/ai canary    # real round-trip against the configured workflow
pnpm --filter @silentskip/ai payload:probe <projectId> <base> <current>
                                       # captures a production read payload, then re-sends it and
                                       # ablations live: bytes → latency per variant
pnpm --filter @silentskip/ai review:once <projectId> <base> <current>  # real pipeline (dev server must be up)
```

# @silentskip/engine

The deterministic analysis core — the part that turns a repository into facts, relations and
eventually findings.

## Landed

- **CSV parser (E2.2)** — `parseCsv(source)`: raw-faithful, never drops or reshapes rows
  (ragged rows, empty lines and the header are all preserved); every cell/row carries exact
  source coordinates (1-based lines, 0-based UTF-16 offsets) so UI anchors map 1:1 to files;
  malformed input (unterminated quotes) is reported in `anomalies`, never silently repaired.
  Guarded by a checked-in 33-file corpus gate (`test/corpus`, provenance in its README).
- **Facts (E2.3, v3 at E7.5)** — `buildFactBundle(sources)`: walks `fc-lang` ASTs of `.fcc`/`.fcg`
  sources into a deterministic `FactBundle` — symbols with scope/container, name references with
  name-level resolution (`resolved` / `ambiguous` / `unresolved` — never guessed), calls
  (callee/receiver/arity, `start`/`wait` prefixes), raw string literals, imports, and doc
  comments attached to the declaration that follows them. Every span is raw-faithful
  (slice == fact) and 1-based-lined; parse problems are surfaced in `parse`, never hidden.
  v2 adds `values` (raw literal initializers bound to their declaring symbol) and `comparisons`
  (raw guard comparisons with faithful left/right spans) — the fact families the AI flow cites
  numbers through, so a claim about a value must point at the fact that owns it.
  v3 adds `paramCount` on function/event symbols — the deterministic material for the call-arity
  check.
  Guarded by a 245-file corpus gate plus engineered fixtures (`test/facts*.test.ts`).
- **Relations (E2.5)** — `buildRelations(bundle, { csvPaths })`: derives `name-refers-to-symbol`,
  `name-refers-to-import`, `call-name-resolves`, `call-receiver-import`, `import-statement`,
  `import-path-matches-file` and `string-names-csv` edges — each with exact spans, a confidence
  class (same-container/top-level bindings and literal facts are `exact`; cross-container
  fallback, import receivers and path-suffix matching are `inferred`) and a human-readable
  derivation chain. Unresolved or ambiguous sites produce no relation at all. Guarded by
  engineered fixtures plus the 245-file corpus gate (`test/relations*.test.ts`).
- **Delta (E2.4)** — `buildDeltaBundle({ before, after })`: identity-keyed A/B diff — symbols
  matched by `kind|container|name` (moved code keeps identity), container declarations reported
  as added/removed only, imports as a set diff, CSV rows keyed by trimmed first column
  (fallback `#row:<index>` for empty/duplicate keys) with changed column indexes and previews.
  Changed symbols also carry `beforeValue`/`afterValue` — the raw literal initializer from each
  side when one exists, honestly omitted otherwise (E7.1).
  Guarded by engineered fixtures plus corpus-grounded mutations (`test/delta*.test.ts`).
- **Value Journey (E2.6)** — `buildJourney({ bundle, relations, origin })`: layered chains from
  a CSV table/row or a symbol — naming literals → binding symbol → use-sites → runtime
  containers, each node with a raw-faithful span, step confidence and derivation; cycles are
  skipped, budgets enforced with a truthful `truncated` flag, and dead values carry an explicit
  "consider pinning" note. Guarded by engineered fixtures (`test/journey.test.ts`).
- **Profile store + Discovery collector (E2.7)** — `ProjectProfileSchema` (contracts) owns the
  JSON shapes for conventions, overrides, read API families, coverage and the editorGen flag;
  `collectDiscoveryCandidates(bundle, relations)` produces the deterministic proposals the AI
  Discovery pass will review later — CSV-naming literals and import paths, each with evidence
  and no scoring. Guarded by fixture tests (`test/profile.test.ts`).
- **Checks (E7.1 → E7.3 full)** — `runChecks({ base, current, delta, registerAnchor, profile?, relations? })`:
  deterministic findings that run over the full scope, never sampled. `STRUCT-01` row width vs
  header (raw structure); `STRUCT-02` duplicate/empty row keys — the key column comes from a
  `pin-binding` profile override (`exact`) or falls back to the first column (`inferred`; the
  message says what to pin); `STRUCT-03` header hygiene (empty/duplicate/whitespace/unicode,
  info); `TYPE-01` declared type row vs real values (mismatch → minor `defaulted`, leading zeros
  → info); `BIND-03` channel ② candidate — an enum covering every header column (inferred;
  pin-matched → `exact`, stale pin → its own finding); `BIND-04` channel ③ — a changed table no
  code references (the absence is exact, the use stays unknown); `DANGLING-REF` removed symbol
  with unresolved same-name references; `CALL-ARITY-01` receiver-aware call arity — member calls
  resolve through the receiver (import alias → the imported file; `e<Type>.M()` → the type's
  graph container; graph containers looked up across the whole bundle), unresolvable or
  ambiguous receivers stay silent instead of guessing, bare calls keep the same-file ladder
  (major/`exact` — signature drift from refactors);
  `ORPHAN-ADD-01` added function nothing references anywhere (info/`exact`). Every finding
  carries severity, confidence, witness anchors (registered into the digest registry) and a
  derivation chain. Guarded by
  `test/checks.test.ts`.
- **Reading plan (E7.1)** — `buildReadingPlan({ scripts, tables, graphEdges })`: the lossless
  compaction the AI flow reads — units contain every changed file exactly once (never split),
  packed in path order under a byte budget (~60 KB per unit), payloads keep every changed name
  and value; the skeleton maps every changed file (`counts`, `changedSymbols`, `headerColumns`,
  deduped import edges) and the base partition is a true set partition of the changed files
  (import edges + same-directory grouping) that the AI may only refine. Guarded by
  `test/plan.test.ts`.
- **Digest (E3, v3 at E7.5)** — `buildDigest({ base, current, budgets? })`: the deterministic
  fact sheet for an A/B range — layer [1] change facts (symbols with values, imports, CSV rows
  and cells), layer [2] linked journeys (60 by default — changed tables/rows first, per-file
  caps, every node anchor-backed), layer [3] engine findings from `runChecks`, layer [4] context
  (doc comments of changed symbols, profile conventions, entity notes). Quantities (`q:*`
  entries: column counts, row counts, symbol counts, literal values) carry the numbers the flow
  may cite; the reading plan ships inside the digest. v3 adds `bodies` — the function bodies of
  added/changed functions (added files first, 4 KB per function, 400 KB budget; every stop or
  per-function truncation is counted in the manifest). A content-stable anchor registry
  (ref+file+line ids with git blob SHAs) and a manifest (budgets, counts, selection notes) ship
  with it; every number is computed here — never by a model. Guarded by engineered +
  corpus-grounded tests (`test/digest*.test.ts`).

## Dev probes

- `pnpm --filter @silentskip/engine probe:project <projectRoot>` — runs the fact + CSV
  pipeline over a real project folder: parse problems, fact totals, resolution stats, CSV
  anomalies, determinism, timing. Exits 1 on parse problems or non-determinism.
- `pnpm --filter @silentskip/engine probe:delta <projectRoot> <baseRef> <currentRef>` — runs
  the delta pipeline over a real git range: changed script/table files, symbol and row changes,
  determinism. Exits 1 on non-determinism.
- `pnpm --filter @silentskip/engine exec tsx scripts/diag-file.ts <file>` — prints the
  first parse diagnostics of one file with the exact source line for each.

## Planned scope

- **Checks full (E7.3)**: `STRUCT-02/03`, `TYPE-01`, PK inference (pin → exact) and the binding
  channels ①/②/③ with pin suggestions — then `BIND-*`, `DRIFT-*`, `REF-*` at E8.
- **AI flow v2 (E7.2)**: multi-call map → read-by-unit → dig → link-verify → synthesize over the
  reading plan, with fact-id placeholders for every number.

## Hard rules

- **Deterministic**: no clocks, no randomness, no environment reads — same inputs + version ⇒
  identical output. This is what makes eval runs reproducible.
- **No project-specific heuristics**: only the FC grammar, CSV format and git may be assumed.
  Anything beyond that is profile data the user pins.
- **Only `exact` relations create hard findings**; `inferred` routes context/suggestions;
  `unknown` is reported honestly and suggests a pin.

## Extension points (E4+)

Check / adapter / pass contracts will be defined here first and then used by in-repo templates;
a check declares the facts it consumes, emits findings with severity + confidence + evidence
anchors, and must stay deterministic.

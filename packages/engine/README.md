# @craftland-qa/engine

The deterministic analysis core — the part that turns a repository into facts, relations and
eventually findings.

## Landed

- **CSV parser (E2.2)** — `parseCsv(source)`: raw-faithful, never drops or reshapes rows
  (ragged rows, empty lines and the header are all preserved); every cell/row carries exact
  source coordinates (1-based lines, 0-based UTF-16 offsets) so UI anchors map 1:1 to files;
  malformed input (unterminated quotes) is reported in `anomalies`, never silently repaired.
  Guarded by a checked-in 33-file corpus gate (`test/corpus`, provenance in its README).
- **Facts (E2.3)** — `buildFactBundle(sources)`: walks `fc-lang` ASTs of `.fcc`/`.fcg` sources
  into a deterministic `FactBundle` — symbols with scope/container, name references with
  name-level resolution (`resolved` / `ambiguous` / `unresolved` — never guessed), calls
  (callee/receiver/arity, `start`/`wait` prefixes), raw string literals, imports, and doc
  comments attached to the declaration that follows them. Every span is raw-faithful
  (slice == fact) and 1-based-lined; parse problems are surfaced in `parse`, never hidden.
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
  Guarded by engineered fixtures plus corpus-grounded mutations (`test/delta.test.ts`).
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

## Dev probes

- `pnpm --filter @craftland-qa/engine probe:project <projectRoot>` — runs the fact + CSV
  pipeline over a real project folder: parse problems, fact totals, resolution stats, CSV
  anomalies, determinism, timing. Exits 1 on parse problems or non-determinism.
- `pnpm --filter @craftland-qa/engine probe:delta <projectRoot> <baseRef> <currentRef>` — runs
  the delta pipeline over a real git range: changed script/table files, symbol and row changes,
  determinism. Exits 1 on non-determinism.
- `pnpm --filter @craftland-qa/engine exec tsx scripts/diag-file.ts <file>` — prints the
  first parse diagnostics of one file with the exact source line for each.

## Planned scope

- **Checks (E7/E8)**: structural (`STRUCT-*`, `TYPE-01`, PK inference) and semantic
  (`BIND-*`, `DRIFT-*`, `REF-*`, silent-skip) — see plan §4/§10.
- **Digest assembly (E3)** and the **AI pipeline (E4)** build on the bundles above.

## Hard rules

- **Deterministic**: no clocks, no randomness, no environment reads — same inputs + version ⇒
  identical output. This is what makes eval runs reproducible.
- **No project-specific heuristics**: only the FC grammar, CSV format and git may be assumed.
  Anything beyond that is profile data the user pins.
- **Only `exact` relations create hard findings**; `inferred` routes context/suggestions;
  `unknown` is reported honestly and suggests a pin.

## Extension points (arriving with E2)

Check / adapter / pass contracts will be defined here first and then used by in-repo templates;
a check declares the facts it consumes, emits findings with severity + confidence + evidence
anchors, and must stay deterministic.

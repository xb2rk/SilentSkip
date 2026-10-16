# @craftland-qa/engine

The deterministic analysis core — the part that turns a repository into facts, relations and
eventually findings. **Currently an empty shell**: implementation starts at E2 (Knowledge core).

## Planned scope

- **Facts (E2)**: `fc-lang` AST walkers over `.fcc`/`.fcg` (symbols, spans, doc comments, calls,
  strings, imports, read-sites) + CSV parsing with cell coordinates → a `FactBundle` per ref.
- **Delta (E2)**: `DeltaBundle` between ref A and B built from those facts (+ git diff).
- **Relations v1 (E2)**: `refers_to`, `calls`, `imports`, `names_csv` — each marked
  `exact` / `inferred` / `unknown` with a confidence score.
- **Value Journey (E2)**: two-layer propagation walk (config value → code → runtime effect).
- **Project Profile + Discovery (E2)**: per-project conventions as *data* (pinned by the user).
- **Checks (E7/E8)**: structural (`STRUCT-*`, `TYPE-01`, PK inference) and semantic
  (`BIND-*`, `DRIFT-*`, `REF-*`, silent-skip) — see plan §4/§10.

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
anchors, and must stay deterministic. Until then this package exports nothing.

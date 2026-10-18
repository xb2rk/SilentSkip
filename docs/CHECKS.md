# Deterministic checks

Every finding below is produced by the engine from recorded facts (spans, CSV cells, symbol
references). The AI never decides whether a check fires; it only narrates the result. Each
finding carries `severity`, `confidence` and anchor ids back to both sides of the comparison.

- `exact` — every derivation step is mechanical (a pinned convention may still be the input,
  but the comparison itself is exact).
- `inferred` — the conclusion depends on an unpinned convention. The message says what to pin
  to make it exact; nothing is concluded silently.

## Shipped rules

| Rule | What it proves | Default severity | Confidence |
|---|---|---|---|
| `STRUCT-01` | A data row whose cell count differs from the header (length-guard skip). | `major` | `exact` |
| `STRUCT-02` | Duplicate or empty row keys in a changed table. | `major` | `exact` with a `pin-row-key`; `inferred` on the first-column fallback |
| `STRUCT-03` | Header hygiene: duplicate, empty, whitespace-padded or non-ASCII header cells. | `info` | `exact` |
| `TYPE-01` | A data cell that fails the declared type row (`int`, `float`, `bool`, …). | `major` | `exact` |
| `DRIFT-01` | A/B header change at stable column count (rename or reorder). Positional readers then read the wrong field without throwing. | `critical` | `exact` |
| `BIND-03` | A changed table whose header cells exactly name the members of one current enum (candidate index binding). | `info` | `inferred`; `exact` with a matching `pin-binding` |
| `BIND-04` | A changed table that no current string literal names and no enum covers. | `info` | `exact` (absence) |
| `BIND-01` | A reader binding pinned by name names a column missing from the current header (the lookup disables the consumer). | `critical` | `exact` |
| `BIND-02` | A pinned guard constant differs from the header width: larger is an out-of-bounds risk, smaller leaves trailing columns never read. | `critical` (OOB) / `major` | `exact` |
| `DANGLING-REF` | A symbol removed on side B still has unresolved same-name references. | `major` | `exact` |
| `CALL-ARITY-01` | A call whose argument count differs from the resolved declaration's parameter count. Receiver-aware; unresolvable or ambiguous targets stay silent. | `major` | `exact` |
| `ORPHAN-ADD-01` | A function added on side B whose name appears in no reference, call or import in the whole current tree. | `info` | `exact` (absence) |
| `REF-01` | A pinned single-value foreign key with values that match no row key of the pinned target table. | `major` | `exact` |
| `REF-02` | A pinned structured cell (`colon`/`pipe`, part N) whose values are malformed or match no row key of the pinned target table. Only the pinned part is interpreted; the rest of the cell is not. | `major` | `exact` |

`REF-01` honors the runtime cast (spec §4.10): `int` compares numerically (`00100` ≡ `100`),
`string` compares exactly. An unknown cast, an unpinned target key or a composite target key is
reported as `info` and never concluded — those paths belong to `REF-02`, which is not shipped
yet.

## Pins (project profile)

A pin is data, not code. It is stored per project and passed into the engine; no check guesses
a project convention beyond the documented fallbacks.

| Kind | Target | Value | Effect |
|---|---|---|---|
| `pin-binding` | `csvPath` | enum name | BIND-03 treats the enum as the index binding and verifies the member set. |
| `pin-row-key` | `csvPath` | comma-separated header names | STRUCT-02 and silent-skip surfaces use these columns as the PK. Composite keys are supported (`ItemId,SortOrder`). |
| `pin-fk` | `csvPath` (source table), `rowKey` (source column) | `<targetCsvPath>#<int\|string>` | Enables REF-01. The target table's key must itself be pinned with `pin-row-key`. |
| `suppress-finding` | any target fields | free-form | Reserved; not consumed by checks yet. |
| `entity-note` | `file`, `symbolId`, `csvPath`, `rowKey`, … | note text | Human context for the report/AI; never changes a check result. |

A pin that points at a missing header/table is reported (`pin`, `pin-missing`, `|column-missing`,
`|target-missing`), never ignored.

## Reader profile

BIND-01/02 and REF-02 only run when the project profile declares the reader expectation. The
engine never infers these from naming style or call shape.

```jsonc
"readerProfile": {
  "bindings": [
    { "csvPath": "Assets/CSV/ShopData.csv", "columns": ["ShopId", "ItemId"] }
  ],
  "guards": [{ "csvPath": "Assets/CSV/ShopData.csv", "constant": 10 }],
  "structuredCells": [
    {
      "csvPath": "Assets/CSV/MissionReward.csv",
      "column": "RewardPool",
      "targetPath": "Assets/CSV/Item.csv",
      "split": "colon",
      "cast": "int",
      "part": 0
    }
  ]
}
```

- A `binding` means the reader resolves these columns by name; a missing name is `BIND-01`.
- A `guard` means the reader stops at a fixed index; a mismatch is `BIND-02`.
- A `structuredCell` means part `part` (zero-based after splitting on `:` or `|`) is a row key of
  `targetPath`. REF-02 reports malformed cells and unmatched parts; it does not interpret other
  parts, and the target key must be pinned with `pin-row-key`. Composite target keys stay out of
  scope (reported as `info`).

## Silent-skip surface (E8.1)

`runSurfaces` scans every CSV table on both refs and records only mechanisms it can prove:

- `length_guard` — row cell count differs from the header (effect `skipped`, inferred).
- `parse_fail` — a cell fails the declared type row (effect `defaulted`; exact when the row key
  is pinned).
- `duplicate_key` — duplicate keys under a **pinned** `pin-row-key` only (effect `last_wins`,
  exact). First-column fallback is a candidate convention, not an identity, so it is not
  surfaced; composite rows would otherwise look like collisions.

`fixed_skip` (type row) is expected and never counted. `nil_read`, `missing_binding`,
`enum_fallback` and `ref_broken` need loader/FK intent pins and are not guessed.

## Not shipped yet

- `REF-02` for partial fallback semantics beyond one pinned part (pipe/pair/enum cells with mixed
  casts) — the pinned single-part form above is shipped.
- Silent-skip mechanisms that require pinned loader intent.

## Tests

```bash
pnpm --filter @craftland-qa/engine test
```

`packages/engine/test/checks.test.ts` covers STRUCT, TYPE, BIND, DRIFT, REF, CALL-ARITY and
ORPHAN rules; `packages/engine/test/surfaces.test.ts` covers the silent-skip surface. Server
tests exercise the profile API and digest wiring (`apps/server/test/profiles.test.ts`,
`apps/server/test/digest.test.ts`).

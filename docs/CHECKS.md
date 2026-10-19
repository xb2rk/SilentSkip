# Deterministic checks

Every finding below is produced by the engine from recorded facts (spans, CSV cells, symbol
references). The AI never decides whether a check fires; it only narrates the result. Each
finding carries `severity`, `confidence` and anchor ids back to both sides of the comparison.

- `exact` — every derivation step is mechanical (a pinned convention may still be the input,
  but the comparison itself is exact).
- `inferred` — the conclusion depends on an unpinned convention. The message says what to pin
  to make it exact; nothing is concluded silently.

`confidence` describes the **observation** (were the facts measured?). A separate optional
`effectConfidence` describes the **runtime impact** (was the consequence proven?). DRIFT-01,
ORPHAN-ADD-01, BIND-01/02, REF-01/02 and every silent-skip entry mark the effect `inferred` unless a
pinned reader profile removes the ambiguity; a finding can therefore be `exact` about the facts and
`inferred` about what the game does with them.

## Shipped rules

| Rule | What it proves | Default severity | Confidence |
|---|---|---|---|
| `STRUCT-01` | A data row whose cell count differs from the header (length-guard skip). | `major` | `exact` |
| `STRUCT-02` | Duplicate or empty row keys in a changed table. | `major` | `exact` with a `pin-row-key`; `inferred` on the first-column fallback |
| `STRUCT-03` | Header hygiene: duplicate, empty, whitespace-padded or non-ASCII header cells. | `info` | `exact` |
| `TYPE-01` | A data cell that fails the declared type row (`int`, `float`, `bool`, …). | `major` | `exact` |
| `DRIFT-01` | A/B header change at stable column count (rename or reorder). Positional readers may then read the wrong field without throwing. | `critical`; `info` for a reorder covered by a pinned name binding, `major` for a rename outside the pin | `exact` observation |
| `BIND-03` | A changed table whose header cells exactly name the members of one current enum (candidate index binding). | `info` | `inferred`; `exact` with a matching `pin-binding` |
| `BIND-04` | A changed table that no current string literal or `EResCSV` member names and no enum covers. | `info` | `exact` (absence) |
| `BIND-01` | A reader binding pinned by name names a column missing from the current header (the lookup disables the consumer). | `critical` | `exact` |
| `BIND-02` | A pinned guard constant differs from the header width: larger is an out-of-bounds risk, smaller leaves trailing columns never read. | `critical` (OOB) / `major` | `exact` |
| `DANGLING-REF` | A symbol removed on side B still has unresolved same-name references. | `major` | `exact` |
| `CALL-ARITY-01` | A call whose argument count differs from the resolved declaration's parameter count. Receiver-aware; unresolvable or ambiguous targets stay silent. | `major` | `exact` |
| `ORPHAN-ADD-01` | A function added on side B whose name appears in no reference, call or import in any scanned source file. Dynamic asset binding (`.ui`/`.prefab` `funcKey`) is outside the scan. | `info` | `exact` (absence within source) |
| `REF-01` | A pinned single-value foreign key with values that match no row key of the pinned target table. | `major` | `exact` |
| `REF-02` | A pinned structured cell (`:`/`\|` parts, optional `;`/`\|` entry list, optional entry index) whose values are malformed or match no row key of the pinned target table. Only the pinned part of each selected entry is interpreted; the rest of the cell is not. | `major` | `exact` |
| `LOC-01` | A localization table (`*key.csv` with a `Key` header and ≥2 known language columns) with duplicate/empty/whitespace keys, empty source cells, empty translations, placeholder multiset mismatches, or keys added/removed between A and B. Detection is shape-based, never a path list; the optional `LanguageKey` metadata row is skipped. | `major` (duplicate/empty key, empty source, placeholder, key removed) / `minor` (empty translation, whitespace) / `info` (key added) | `exact` |

`REF-01` honors the runtime cast (spec §4.10): `int` compares numerically (`00100` ≡ `100`),
`string` compares exactly. An unknown cast, an unpinned target key or a composite target key is
reported as `info` and never concluded — those paths belong to `REF-02`, which is not shipped
yet.

## Localization (E9)

LOC-01 detects localization tables by shape, not by a configured path: the filename must end in
`key.csv`/`key.tsv` (start or `_`/`-` before `key`), the first header cell must be `Key`, and at
least two header cells must be known language names (English, Vietnamese, Thai, Traditional/
Simplified Chinese, Indonesian, Brazilian Portuguese, Spanish, Russian, French, German, Turkish,
Hindi, Arabic, Bengali, Malay, Burmese, Urdu, Romanian, Japanese, Korean, Italian, Portuguese).
The source column is English when present, otherwise the first known language. A row whose trimmed
key is `LanguageKey` is treated as metadata and skipped; hand-verified on a project whose table
carries a `LanguageKey` metadata row, and harmless on one without such a row.

Observations are exact and multiset-based: placeholder tokens (`{0}`, `%s`, `%1$d`) are compared
as multisets after ignoring color tags, duplicate keys are counted on the trimmed key, and empty
translations only count rows whose source cell is non-empty. The dedicated report
(`GET /api/projects/:id/localization?base&current`) returns per-language coverage plus aggregated
issues with samples and anchors; the same analyzer feeds the LOC-01 digest findings for changed
tables only, so unchanged tables stay silent.

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

BIND-01/02, REF-02 and the pinned surface mechanisms only run when the project profile declares
the reader expectation. The engine never infers these from naming style or call shape.

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
      "part": 1,
      "entrySeparator": "semicolon",
      "entryIndex": 0
    }
  ],
  "nilReads": [{ "csvPath": "Assets/CSV/ShopData.csv", "column": "ShopId" }],
  "enumFallbacks": [
    { "csvPath": "Assets/CSV/ShopData.csv", "column": "OfferKind", "enumName": "EOfferKind" }
  ]
}
```

- A `binding` means the reader resolves these columns by name; a missing name is `BIND-01`.
- A `guard` means the reader stops at a fixed index; a mismatch is `BIND-02`.
- A `structuredCell` means entry `entryIndex` (all entries when absent) is split on `split`, and
  part `part` (zero-based) is a row key of `targetPath`. `entrySeparator` covers pair lists such as
  `100:2;999:1`. REF-02 reports malformed entries and unmatched parts; it does not interpret other
  parts, and the target key must be pinned with `pin-row-key`. Composite target keys stay out of
  scope (reported as `info`).
- A `nilRead` means an empty cell in `column` makes the loader disable the row (`nil_read` surface).
- An `enumFallback` means a value in `column` outside enum `enumName` makes the loader fall back
  (`enum_fallback` surface). The enum is matched by name in the current facts.

## EditorGen indexing

Channel ② of §4.5 is optional and off by default. When `editorGenIndex` is enabled in the project
profile, `EResCSV.<Name>` member references are linked to the unique CSV table with the same base
name (`EResCSV.UnitData` → `UnitData.csv`) as an exact relation. With the flag off the channel is
ignored, because generated-enum naming is a project convention rather than a universal rule.
Linked tables no longer produce `BIND-04`.

## Silent-skip surface (E8.1)

`runSurfaces` scans every CSV table on both refs and records only mechanisms it can prove:

- `length_guard` — row cell count differs from the header (effect `skipped`; the skip is a runtime
  convention, so the effect is inferred).
- `parse_fail` — a cell fails the declared type row (effect `defaulted`; exact value/type
  mismatch, inferred loader behavior).
- `duplicate_key` — duplicate keys under a **pinned** `pin-row-key` only (effect `last_wins`; the
  collision is exact, the overwrite convention is inferred). First-column fallback is a candidate
  convention, not an identity, so it is not surfaced; composite rows would otherwise look like
  collisions.
- `missing_binding` — a pinned name binding targets a column the header lacks (effect `disabled`;
  the missing column is exact, the disable behavior is inferred).
- `nil_read` — a pinned required column has an empty cell (effect `disabled`; the empty cell is
  exact, the row-disable convention is inferred).
- `enum_fallback` — a pinned enum column holds a value outside the pinned enum (effect `fallback`;
  the unknown member is exact, the fallback convention is inferred).
- `ref_broken` — a pinned `pin-fk` source cell matches no target row key under the declared cast
  (effect `fallback`; the missing target is exact, the fallback convention is inferred).

Surfaces are a deterministic panel for humans; they are not sent to the AI prompts. Reader-profile
findings do reach the AI as engine findings, with `effectConfidence` attached.

`fixed_skip` (type row) is expected and never counted. `nil_read`, `missing_binding`,
`enum_fallback` and `ref_broken` are emitted only after the profile pins the loader/FK intent.

## Not shipped yet

- `REF-02` for partial fallback semantics beyond one pinned part per entry (mixed casts and
  multi-part references) — the pinned entry/part form above is shipped.
- Silent-skip mechanisms beyond the seven listed above; anything else stays unguessed.

## Hardening gate (E8)

`packages/engine/test/eval.test.ts` runs the real `buildDigest` pipeline over 20 injected defects
(each must surface as its owning rule: STRUCT-01/02/03, TYPE-01, BIND-01/02/03, DRIFT-01, REF-01/02,
DANGLING-REF, CALL-ARITY-01, ORPHAN-ADD-01) plus 4 clean cases that must yield zero findings: a
value-only CSV change behind a named loader, a rename with both call and definition updated, the
checked-in 10-file CSV fixtures unchanged, and an `EResCSV` link that only activates with
editorGen indexing enabled.

```bash
pnpm --filter @silentskip/engine exec vitest run test/eval.test.ts
```

The server readers are part of the gate: the worktree file set comes from
`git ls-files --cached --others --exclude-standard` (ignored build artifacts never enter the
digest), and CRLF is canonicalized to LF on both refs and worktree so `core.autocrlf` cannot
fabricate whole-file changes.

## Tests

```bash
pnpm --filter @silentskip/engine test
```

`packages/engine/test/checks.test.ts` covers STRUCT, TYPE, BIND, DRIFT, REF, CALL-ARITY and
ORPHAN rules; `packages/engine/test/surfaces.test.ts` covers the silent-skip surface. Server
tests exercise the profile API and digest wiring (`apps/server/test/profiles.test.ts`,
`apps/server/test/digest.test.ts`).

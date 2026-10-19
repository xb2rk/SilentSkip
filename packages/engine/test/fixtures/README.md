# CSV fixtures

Hand-written synthetic CSV tables used by the engine's CSV fixture gates
(`test/csv-fixtures.test.ts`, `test/eval.test.ts`). None of these files come from a real project —
they exist so the parser and the digest pipeline can be exercised on a small, deterministic,
checked-in set without shipping third-party game data.

Layout:

- `csv/*.csv` — 10 config tables (header row, type row, then data rows; some cells contain
  leading zeros and quoted commas).
- `localization/key.csv`, `localization/template.csv` — localization-shaped tables with a
  `LanguageKey` metadata row.

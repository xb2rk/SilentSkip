import { z } from "zod";

import { AnchorSchema } from "./digest";

/**
 * Localization report (E9) - deterministic LOC-01 output for a `*key.csv` table.
 *
 * The report is build-only data: localization tables are found by filename (`*key.csv`)
 * plus a language header, never by a project-specific path list. A header whose first
 * column is `Key` and that has at least two known language columns is treated as a
 * localization table; an optional `LanguageKey` metadata row is skipped when present.
 *
 * Every issue carries exact, content-stable anchors. Counts are observations, never guessed
 * runtime effects: a missing translation is an empty cell, a placeholder mismatch is a
 * multiset difference between the source string and the translated string.
 */

export const LOCALIZATION_SCHEMA_VERSION = 1;

export const LocalizationIssueKindSchema = z.enum([
  "duplicate-key",
  "empty-key",
  "key-whitespace",
  "empty-source",
  "empty-translation",
  "placeholder-mismatch",
  "key-added",
  "key-removed",
]);

export const LocalizationSeveritySchema = z.enum(["critical", "major", "minor", "info"]);

export const LocalizationIssueSchema = z.object({
  id: z.string(),
  ruleId: z.literal("LOC-01"),
  kind: LocalizationIssueKindSchema,
  severity: LocalizationSeveritySchema,
  confidence: z.literal("exact"),
  table: z.string(),
  key: z.string().optional(),
  column: z.string().optional(),
  count: z.number().int().nonnegative(),
  samples: z.array(z.string()),
  anchors: z.array(AnchorSchema),
});

export const LocalizationLanguageCoverageSchema = z.object({
  column: z.string(),
  filled: z.number().int().nonnegative(),
  empty: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  percent: z.number().nonnegative(),
});

export const LocalizationTableStatusSchema = z.enum(["added", "removed", "changed", "unchanged"]);

export const LocalizationTableReportSchema = z.object({
  path: z.string(),
  status: LocalizationTableStatusSchema,
  sourceColumn: z.string(),
  keyCount: z.number().int().nonnegative(),
  languageCount: z.number().int().nonnegative(),
  metadataRowsSkipped: z.number().int().nonnegative(),
  duplicateKeyCount: z.number().int().nonnegative(),
  emptyKeyCount: z.number().int().nonnegative(),
  whitespaceKeyCount: z.number().int().nonnegative(),
  emptySourceCount: z.number().int().nonnegative(),
  emptyTranslationCount: z.number().int().nonnegative(),
  placeholderMismatchCount: z.number().int().nonnegative(),
  addedKeyCount: z.number().int().nonnegative(),
  removedKeyCount: z.number().int().nonnegative(),
  coverage: z.array(LocalizationLanguageCoverageSchema),
  issues: z.array(LocalizationIssueSchema),
});

export const LocalizationTotalsSchema = z.object({
  tables: z.number().int().nonnegative(),
  keys: z.number().int().nonnegative(),
  duplicateKeys: z.number().int().nonnegative(),
  emptyTranslations: z.number().int().nonnegative(),
  placeholderMismatches: z.number().int().nonnegative(),
  addedKeys: z.number().int().nonnegative(),
  removedKeys: z.number().int().nonnegative(),
});

export const LocalizationReportSchema = z.object({
  schemaVersion: z.literal(LOCALIZATION_SCHEMA_VERSION),
  refs: z.object({
    base: z.string(),
    current: z.string(),
  }),
  tables: z.array(LocalizationTableReportSchema),
  totals: LocalizationTotalsSchema,
  note: z.string(),
});

export type LocalizationIssueKind = z.infer<typeof LocalizationIssueKindSchema>;
export type LocalizationSeverity = z.infer<typeof LocalizationSeveritySchema>;
export type LocalizationIssue = z.infer<typeof LocalizationIssueSchema>;
export type LocalizationLanguageCoverage = z.infer<typeof LocalizationLanguageCoverageSchema>;
export type LocalizationTableStatus = z.infer<typeof LocalizationTableStatusSchema>;
export type LocalizationTableReport = z.infer<typeof LocalizationTableReportSchema>;
export type LocalizationTotals = z.infer<typeof LocalizationTotalsSchema>;
export type LocalizationReport = z.infer<typeof LocalizationReportSchema>;

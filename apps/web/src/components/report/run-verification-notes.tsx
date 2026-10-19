import type { ReviewRunResult } from "@silentskip/contracts";
import { useTranslation } from "react-i18next";
import { PASS_LABEL_KEYS } from "@/components/report/run-summary-card";

export const ISSUE_KIND_LABEL_KEYS: Record<string, string> = {
  "unknown-anchor": "run.issueKindUnknownAnchor",
  "new-anchor": "run.issueKindNewAnchor",
  "finding-unanchored": "run.issueKindFindingUnanchored",
  "unknown-fact": "run.issueKindUnknownFact",
  "free-number": "run.issueKindFreeNumber",
  "claim-invalid": "run.issueKindClaimInvalid",
  "claim-false": "run.issueKindClaimFalse",
  "quote-unverified": "run.issueKindQuoteUnverified",
  "theme-invalid": "run.issueKindThemeInvalid",
  "map-invalid": "run.issueKindMapInvalid",
  "read-invalid": "run.issueKindReadInvalid",
  "dig-invalid": "run.issueKindDigInvalid",
  "synthesize-invalid": "run.issueKindSynthesizeInvalid",
  "verdict-downgraded": "run.issueKindVerdictDowngraded",
  "map-timeout": "run.issueKindMapTimeout",
  "read-timeout": "run.issueKindReadTimeout",
  "dig-timeout": "run.issueKindDigTimeout",
  "synthesize-timeout": "run.issueKindSynthesizeTimeout",
  "map-unavailable": "run.issueKindMapUnavailable",
  "read-unavailable": "run.issueKindReadUnavailable",
  "dig-unavailable": "run.issueKindDigUnavailable",
  "synthesize-unavailable": "run.issueKindSynthesizeUnavailable",
};

interface RunVerificationNotesProps {
  readonly result: ReviewRunResult;
}

export function RunVerificationNotes({ result }: RunVerificationNotesProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-5 pt-2">
      <section className="space-y-2">
        <h3 className="text-body font-semibold">{t("run.verificationTitle")}</h3>
        {result.verification.issues.length === 0 ? (
          <p className="text-meta text-muted-foreground">{t("run.verificationIssuesEmpty")}</p>
        ) : (
          <details className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <summary className="cursor-pointer text-meta font-medium hover:text-foreground">
              {t("run.verificationIssuesTitle", {
                count: result.verification.issues.length,
              })}
            </summary>
            <ul className="mt-2 max-h-60 space-y-1.5 overflow-y-auto text-meta">
              {result.verification.issues.map((issue) => (
                <li
                  key={`${issue.pass}|${issue.kind}|${issue.target}|${issue.detail.slice(0, 80)}`}
                  className="leading-relaxed"
                >
                  <span className="font-mono text-micro text-muted-foreground">
                    {t(PASS_LABEL_KEYS[issue.pass] ?? issue.pass)} ·{" "}
                    {t(ISSUE_KIND_LABEL_KEYS[issue.kind] ?? issue.kind)}
                  </span>
                  <span className="text-muted-foreground"> — </span>
                  {issue.detail}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="space-y-1.5">
        <h3 className="text-body font-semibold">{t("run.notesContextTitle")}</h3>
        <p className="text-meta text-muted-foreground">
          {t("run.contextCounts", {
            changeFacts: result.contextManifest.counts.changeFacts,
            linked: result.contextManifest.counts.linked,
            contextItems: result.contextManifest.counts.contextItems,
            evidence: result.contextManifest.counts.evidence,
            dropped: result.contextManifest.counts.evidenceDropped,
          })}
        </p>
        {result.contextManifest.notes.map((note) => (
          <p key={note} className="text-meta text-muted-foreground">
            {note}
          </p>
        ))}
      </section>
    </div>
  );
}

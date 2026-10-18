import type {
  Anchor,
  LocalizationIssue,
  LocalizationIssueKind,
  LocalizationTableReport,
} from "@silentskip/contracts";
import { WORKTREE_REF } from "@silentskip/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Languages, MessageCircleQuestion, RefreshCw, TriangleAlert } from "lucide-react";
import { type ReactElement, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { EvidenceDialog } from "@/components/report/evidence-dialog";
import { AnchorChip } from "@/components/report/finding-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useProject } from "@/contexts/project-context";
import { useLocalization, useProjectRefs } from "@/lib/use-projects";

const ISSUE_KIND_KEYS: Record<LocalizationIssueKind, string> = {
  "duplicate-key": "localization.issueDuplicate",
  "empty-key": "localization.issueEmptyKey",
  "key-whitespace": "localization.issueWhitespace",
  "empty-source": "localization.issueEmptySource",
  "empty-translation": "localization.issueEmptyTranslation",
  "placeholder-mismatch": "localization.issuePlaceholder",
  "key-added": "localization.issueAdded",
  "key-removed": "localization.issueRemoved",
};

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-danger/15 text-danger",
  major: "bg-warning/15 text-warning",
  minor: "bg-info/15 text-info",
  info: "bg-muted text-muted-foreground",
};

function Stat({ label, value }: { readonly label: string; readonly value: number }): ReactElement {
  return (
    <div className="surface p-3">
      <p className="text-micro text-muted-foreground">{label}</p>
      <p className="text-body-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function CoverageBar({
  column,
  filled,
  total,
  percent,
}: {
  readonly column: string;
  readonly filled: number;
  readonly total: number;
  readonly percent: number;
}): ReactElement {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-meta">{column}</span>
        <span className="text-micro tabular-nums text-muted-foreground">
          {filled}/{total} · {percent}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function IssueRow({
  issue,
  anchorsById,
  onAnchorClick,
}: {
  readonly issue: LocalizationIssue;
  readonly anchorsById: ReadonlyMap<string, Anchor>;
  readonly onAnchorClick: (anchor: Anchor) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <li className="space-y-1.5 border-t border-border/60 pt-2.5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={SEVERITY_STYLES[issue.severity] ?? ""} variant="outline">
          {t(ISSUE_KIND_KEYS[issue.kind])}
        </Badge>
        {issue.column !== undefined && (
          <span className="text-micro text-muted-foreground">{issue.column}</span>
        )}
        <span className="text-micro tabular-nums text-muted-foreground">×{issue.count}</span>
      </div>
      {issue.samples.length > 0 && (
        <p className="font-mono text-micro text-muted-foreground">
          {issue.samples.join(", ")}
          {issue.count > issue.samples.length ? ` +${issue.count - issue.samples.length}` : ""}
        </p>
      )}
      {issue.anchors.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {issue.anchors.map((anchor) => (
            <AnchorChip
              key={anchor.id}
              anchorId={anchor.id}
              anchorsById={anchorsById}
              onAnchorClick={onAnchorClick}
            />
          ))}
        </div>
      )}
    </li>
  );
}

function TableCard({
  table,
  anchorsById,
  onAnchorClick,
  onAsk,
}: {
  readonly table: LocalizationTableReport;
  readonly anchorsById: ReadonlyMap<string, Anchor>;
  readonly onAnchorClick: (anchor: Anchor) => void;
  readonly onAsk: (table: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="font-mono text-body">{table.path}</CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-micro text-muted-foreground">
            <Badge variant="outline">{t(`localization.status.${table.status}`)}</Badge>
            <span>
              {t("localization.tableMeta", {
                keys: table.keyCount,
                languages: table.languageCount,
              })}
            </span>
            {table.metadataRowsSkipped > 0 && (
              <span>{t("localization.metadataSkipped", { count: table.metadataRowsSkipped })}</span>
            )}
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => onAsk(table.path)}>
          <MessageCircleQuestion className="size-3.5" />
          {t("localization.askTable")}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {table.coverage.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {table.coverage.map((coverage) => (
              <CoverageBar key={coverage.column} {...coverage} />
            ))}
          </div>
        )}
        {table.issues.length === 0 ? (
          <p className="text-meta text-muted-foreground">{t("localization.noIssues")}</p>
        ) : (
          <ul className="space-y-2.5">
            {table.issues.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                anchorsById={anchorsById}
                onAnchorClick={onAnchorClick}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Localization report page (E9) - deterministic LOC-01 output for detected *key.csv tables.
 * No AI and no project-specific configuration: a table is detected from its language header.
 */
export function LocalizationPage(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: "/localization" });
  const { projects, activeProjectId, setActiveProjectId } = useProject();

  const projectId = search.projectId ?? activeProjectId ?? null;
  const baseRef = search.base ?? null;
  const currentRef = search.current ?? null;
  const refsQuery = useProjectRefs(projectId);
  const reportQuery = useLocalization(projectId, baseRef, currentRef);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const refOptions = useMemo(() => {
    const refs = refsQuery.data;
    if (refs === undefined) return [];
    const names = refs.refs.map((ref) => ref.name);
    return refs.head === null ? names : ["HEAD", ...names];
  }, [refsQuery.data]);

  const anchorsById = useMemo(
    () =>
      new Map(
        (reportQuery.data?.tables ?? [])
          .flatMap((table) => table.issues)
          .flatMap((issue) => issue.anchors)
          .map((item) => [item.id, item]),
      ),
    [reportQuery.data],
  );

  function changeScope(next: {
    projectId?: string | null;
    base?: string | null;
    current?: string | null;
  }): void {
    const nextProject = next.projectId === undefined ? projectId : next.projectId;
    const nextBase = next.base === undefined ? baseRef : next.base;
    const nextCurrent = next.current === undefined ? currentRef : next.current;
    void navigate({
      to: "/localization",
      replace: true,
      search: {
        ...(nextProject === null ? {} : { projectId: nextProject }),
        ...(nextBase === null ? {} : { base: nextBase }),
        ...(nextCurrent === null ? {} : { current: nextCurrent }),
      },
    });
  }

  function askAbout(table: string): void {
    if (projectId === null || baseRef === null || currentRef === null) return;
    void navigate({
      to: "/what-if",
      search: {
        projectId,
        base: baseRef,
        current: currentRef,
        q: t("localization.askQuestion", { table }),
      },
    });
  }

  const report = reportQuery.data;
  const scopeReady = projectId !== null && baseRef !== null && currentRef !== null;

  return (
    <div className="space-y-6">
      <PageHeader title={t("localization.title")} description={t("localization.description")} />

      <Card>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-meta">{t("compare.projectTitle")}</Label>
            <Select
              value={projectId ?? ""}
              onValueChange={(value) => {
                const next = value === "" ? null : value;
                if (next !== null) setActiveProjectId(next);
                changeScope({ projectId: next, base: null, current: null });
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("compare.projectPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-meta">{t("whatIf.scopeBase")}</Label>
            <Select
              value={baseRef ?? ""}
              onValueChange={(value) => changeScope({ base: value === "" ? null : value })}
              disabled={projectId === null || refOptions.length === 0}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("compare.refPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {refOptions.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-meta">{t("whatIf.scopeCurrent")}</Label>
            <Select
              value={currentRef ?? ""}
              onValueChange={(value) => changeScope({ current: value === "" ? null : value })}
              disabled={projectId === null || refOptions.length === 0}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("compare.refPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={WORKTREE_REF}>{t("compare.worktreeOption")}</SelectItem>
                {refOptions.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {projectId === null ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Languages}
              title={t("localization.noProjectTitle")}
              description={t("localization.noProjectDescription")}
              action={
                <Button size="sm" onClick={() => void navigate({ to: "/" })}>
                  {t("localization.chooseProject")}
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : reportQuery.isError ? (
        <Card>
          <CardContent className="space-y-3">
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>{t("errors.loadTitle")}</AlertTitle>
              <AlertDescription>{t("errors.loadDescription")}</AlertDescription>
            </Alert>
            <Button size="sm" variant="outline" onClick={() => void reportQuery.refetch()}>
              <RefreshCw className="size-3.5" />
              {t("common.retry")}
            </Button>
          </CardContent>
        </Card>
      ) : reportQuery.isPending || !scopeReady ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-40" />
        </div>
      ) : report === undefined ? null : report.tables.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Languages}
              title={t("localization.emptyTitle")}
              description={t("localization.emptyDescription")}
            />
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label={t("localization.statKeys")} value={report.totals.keys} />
            <Stat label={t("localization.statDuplicates")} value={report.totals.duplicateKeys} />
            <Stat label={t("localization.statEmpty")} value={report.totals.emptyTranslations} />
            <Stat
              label={t("localization.statPlaceholders")}
              value={report.totals.placeholderMismatches}
            />
            <Stat label={t("localization.statAdded")} value={report.totals.addedKeys} />
            <Stat label={t("localization.statRemoved")} value={report.totals.removedKeys} />
          </div>
          <p className="text-meta text-muted-foreground">{report.note}</p>
          <div className="space-y-4">
            {report.tables.map((table) => (
              <TableCard
                key={table.path}
                table={table}
                anchorsById={anchorsById}
                onAnchorClick={setAnchor}
                onAsk={askAbout}
              />
            ))}
          </div>
        </>
      )}

      <EvidenceDialog anchor={anchor} onOpenChange={(open) => !open && setAnchor(null)} />
    </div>
  );
}

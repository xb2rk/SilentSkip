import type {
  Anchor,
  LocalizationIssue,
  LocalizationIssueKind,
  LocalizationTableReport,
} from "@silentskip/contracts";
import { WORKTREE_REF } from "@silentskip/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { cn } from "cn";
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
import { useCopilot } from "@/contexts/copilot-context";
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
    <div className="surface p-3.5 space-y-1 rounded-xl">
      <p className="text-micro font-medium text-muted-foreground">{label}</p>
      <p className="text-h3 font-semibold tabular-nums text-foreground">{value}</p>
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
    <div className="space-y-1.5 p-2 rounded-lg bg-muted/30 border border-border/40">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-meta font-mono font-medium text-foreground">{column}</span>
        <span className="text-micro tabular-nums text-muted-foreground font-medium">
          {filled}/{total} · {percent}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-300",
            percent === 100 ? "bg-positive" : percent >= 80 ? "bg-primary" : "bg-warning",
          )}
          style={{ width: `${percent}%` }}
        />
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
    <Card className="surface border-border/60 transition-all hover:border-border">
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
  const { openCopilot } = useCopilot();
  const search = useSearch({ from: "/localization" });
  const { projects, activeProjectId, setActiveProjectId } = useProject();

  const projectId = search.projectId ?? activeProjectId ?? projects[0]?.id ?? null;
  const targetRef = search.ref ?? search.current ?? WORKTREE_REF;
  const currentRef = targetRef;
  const baseRef = search.base ?? (targetRef === WORKTREE_REF ? "HEAD" : targetRef);

  const refsQuery = useProjectRefs(projectId);
  const reportQuery = useLocalization(projectId, baseRef, currentRef);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

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

  function changeProject(nextProjectId: string): void {
    setActiveProjectId(nextProjectId);
    void navigate({
      to: "/localization",
      replace: true,
      search: {
        projectId: nextProjectId,
        ref: targetRef,
        current: targetRef,
        base: targetRef === WORKTREE_REF ? "HEAD" : targetRef,
      },
    });
  }

  function changeTargetRef(newRef: string): void {
    const nextBase = newRef === WORKTREE_REF ? "HEAD" : newRef;
    void navigate({
      to: "/localization",
      replace: true,
      search: {
        ...(projectId === null ? {} : { projectId }),
        ref: newRef,
        current: newRef,
        base: nextBase,
      },
    });
  }

  function askAbout(table: string): void {
    if (projectId === null) return;
    openCopilot({
      projectId,
      baseRef,
      currentRef,
      initialQuestion: t("localization.askQuestion", { table }),
    });
  }

  const report = reportQuery.data;

  return (
    <div className="space-y-6">
      <PageHeader title={t("localization.title")} description={t("localization.description")} />

      <Card className="surface border-border/60">
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-meta">{t("compare.projectTitle")}</Label>
            <Select value={projectId ?? ""} onValueChange={changeProject}>
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
            <Label className="text-meta">Phiên bản / Nhánh kiểm tra</Label>
            <Select value={targetRef} onValueChange={changeTargetRef} disabled={projectId === null}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Chọn phiên bản hoặc nhánh..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={WORKTREE_REF}>
                  {t("compare.worktreeOption", { defaultValue: "Bản đang làm (chưa commit)" })}
                </SelectItem>
                {refsQuery.data?.head !== null && (
                  <SelectItem value="HEAD">HEAD — commit mới nhất</SelectItem>
                )}
                {refsQuery.data?.refs
                  .filter((r) => r.kind === "branch" && r.name !== "HEAD")
                  .map((branch) => (
                    <SelectItem key={branch.name} value={branch.name}>
                      {branch.name}
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
      ) : reportQuery.isPending ? (
        <div className="surface p-8 text-center space-y-3 rounded-xl border border-border/60">
          <div className="inline-flex items-center justify-center size-10 rounded-full bg-primary/10 text-primary animate-spin">
            <RefreshCw className="size-5" />
          </div>
          <p className="text-body font-semibold text-foreground">
            Đang phân tích các bảng localization (*key.csv)...
          </p>
          <p className="text-meta text-muted-foreground">
            Kiểm tra coverage, trùng key, thiếu bản dịch và tính hợp lệ của placeholder.
          </p>
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

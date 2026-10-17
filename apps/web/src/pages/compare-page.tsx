import {
  AppError,
  type DiffFileEntry,
  type DiffFileStatus,
  ErrorCodes,
  type GitHead,
  type GitRef,
  type GitRefKind,
  WORKTREE_REF,
} from "@craftland-qa/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import type { TFunction } from "i18next";
import {
  ArrowLeftRight,
  GitCompareArrows,
  History,
  Info,
  Loader2,
  Play,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useProject } from "@/contexts/project-context";
import { useDiffSummary, useProjectRefs } from "@/lib/use-projects";
import { useStartReview } from "@/lib/use-runs";

const GOAL_SAMPLES = ["compare.goalSample1", "compare.goalSample2", "compare.goalSample3"] as const;

type Preset = "worktree" | "vs-main" | "custom";

const STATUS_STYLES: Record<DiffFileStatus, string> = {
  A: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  M: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  D: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  R: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  U: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
};

const STATUS_LABEL_KEYS: Record<DiffFileStatus, string> = {
  A: "compare.statusAdded",
  M: "compare.statusModified",
  D: "compare.statusDeleted",
  R: "compare.statusRenamed",
  U: "compare.statusUntracked",
};

const KIND_LABEL_KEYS: Record<DiffFileEntry["kind"], string> = {
  csv: "compare.kindCsv",
  script: "compare.kindScript",
  other: "compare.kindOther",
};

function shortHash(hash: string): string {
  return hash.slice(0, 7);
}

interface RefOption {
  readonly value: string;
  readonly label: string;
}

interface RefGroup {
  readonly labelKey: string;
  readonly options: readonly RefOption[];
}

interface RefGroups {
  readonly head: RefOption | null;
  readonly groups: readonly RefGroup[];
}

const KIND_GROUP_ORDER: readonly GitRefKind[] = ["branch", "remote", "tag"];

const KIND_GROUP_LABEL_KEYS: Record<GitRefKind, string> = {
  branch: "compare.refGroupBranch",
  remote: "compare.refGroupRemote",
  tag: "compare.refGroupTag",
};

/**
 * Group refs by kind (branch → remote → tag) so long ref lists stay scannable; HEAD is
 * hoisted above the groups. Refs keep their exact git names as values — no rewriting.
 */
function buildRefGroups(refs: readonly GitRef[], head: GitHead | null, t: TFunction): RefGroups {
  const groups: RefGroup[] = [];
  for (const kind of KIND_GROUP_ORDER) {
    const options = refs
      .filter((ref) => ref.kind === kind)
      .map((ref) => ({ value: ref.name, label: ref.name }));
    if (options.length > 0) {
      groups.push({ labelKey: KIND_GROUP_LABEL_KEYS[kind], options });
    }
  }
  return {
    head: head === null ? null : { value: "HEAD", label: t("compare.headOption") },
    groups,
  };
}

interface RefInfo {
  readonly mono: string;
  readonly text: string;
}

interface VersionPanelProps {
  readonly label: string;
  readonly value: string | null;
  readonly onValueChange: (value: string) => void;
  readonly leading: readonly RefOption[];
  readonly refGroups: RefGroups;
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly info: RefInfo | null;
}

/** One side of the A/B picker: a grouped ref select plus the resolved commit info box. */
function VersionPanel({
  label,
  value,
  onValueChange,
  leading,
  refGroups,
  placeholder,
  disabled,
  info,
}: VersionPanelProps) {
  const { t } = useTranslation();
  const hasOptions = leading.length > 0 || refGroups.head !== null || refGroups.groups.length > 0;
  return (
    <div className="space-y-2">
      <Label className="text-[12.5px]">{label}</Label>
      <Select value={value ?? ""} onValueChange={onValueChange} disabled={disabled || !hasOptions}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {leading.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
          {refGroups.head !== null && (
            <SelectItem value={refGroups.head.value}>{refGroups.head.label}</SelectItem>
          )}
          {refGroups.groups.map((group) => (
            <SelectGroup key={group.labelKey}>
              <SelectLabel>{t(group.labelKey)}</SelectLabel>
              {group.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      <div className="min-h-11 rounded-lg border border-border/60 bg-muted/40 p-3 text-[12px] text-muted-foreground">
        {info === null ? (
          t("compare.refEmpty")
        ) : (
          <>
            <span className="font-mono text-[11.5px]">{info.mono}</span>
            {info.text !== "" && <span> · {info.text}</span>}
          </>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { readonly status: DiffFileStatus }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[10.5px] font-medium",
        STATUS_STYLES[status],
      )}
    >
      {t(STATUS_LABEL_KEYS[status])}
    </span>
  );
}

interface DiffPreviewProps {
  readonly files: readonly DiffFileEntry[];
  readonly additions: number;
  readonly deletions: number;
  readonly untrackedFiles: number;
}

const MAX_DIFF_ROWS = 100;

/** Compact file list with status/kind badges and per-file line counts. */
function DiffPreview({ files, additions, deletions, untrackedFiles }: DiffPreviewProps) {
  const { t } = useTranslation();
  if (files.length === 0) {
    return <p className="text-[12.5px] text-muted-foreground">{t("compare.diffEmpty")}</p>;
  }
  const shown = files.slice(0, MAX_DIFF_ROWS);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-[12px]">
        <span className="tabular-nums text-emerald-600 dark:text-emerald-400">+{additions}</span>
        <span className="tabular-nums text-rose-600 dark:text-rose-400">−{deletions}</span>
        {untrackedFiles > 0 && (
          <span className="text-muted-foreground">
            {t("compare.diffUntracked", { count: untrackedFiles })}
          </span>
        )}
      </div>
      <div className="max-h-72 overflow-y-auto rounded-lg border border-border/60">
        {shown.map((file) => (
          <div
            key={file.path}
            className="flex items-center gap-2 border-b border-border/40 px-3 py-1.5 text-[12px] last:border-0"
          >
            <StatusBadge status={file.status} />
            <Badge
              variant="outline"
              className="h-5 shrink-0 px-1.5 text-[10.5px] font-normal uppercase"
            >
              {t(KIND_LABEL_KEYS[file.kind])}
            </Badge>
            <span className="truncate font-mono text-[11.5px]" title={file.path}>
              {file.oldPath !== null ? `${file.oldPath} → ${file.path}` : file.path}
            </span>
            <span className="ml-auto shrink-0 tabular-nums text-[11.5px] text-muted-foreground">
              {file.additions !== null && (
                <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>
              )}
              {file.additions !== null && file.deletions !== null && " "}
              {file.deletions !== null && (
                <span className="text-rose-600 dark:text-rose-400">−{file.deletions}</span>
              )}
            </span>
          </div>
        ))}
      </div>
      {files.length > shown.length && (
        <p className="text-[11.5px] text-muted-foreground">
          {t("compare.diffMore", { count: files.length - shown.length })}
        </p>
      )}
    </div>
  );
}

/**
 * Compare screen (E1): pick project + A/B refs and preview the real diff (files, statuses,
 * line counts). The AI run itself stays disabled until E4.
 */
export function ComparePage() {
  const { t } = useTranslation();
  const { projects, activeProjectId, setActiveProjectId } = useProject();
  const navigate = useNavigate();
  const startReview = useStartReview();
  const [preset, setPreset] = useState<Preset>("worktree");
  const [customBase, setCustomBase] = useState<string | null>(null);
  const [customCurrent, setCustomCurrent] = useState<string | null>(null);
  const [goal, setGoal] = useState("");

  const refsQuery = useProjectRefs(activeProjectId);
  const refs = refsQuery.data?.refs ?? [];
  const head = refsQuery.data?.head ?? null;

  const defaultBranch = useMemo(() => {
    const branches = refs.filter((ref) => ref.kind === "branch");
    return (
      branches.find((branch) => branch.name === "main")?.name ??
      branches.find((branch) => branch.name === "master")?.name ??
      branches[0]?.name ??
      null
    );
  }, [refs]);

  const baseRef =
    activeProjectId === null
      ? null
      : preset === "custom"
        ? customBase
        : preset === "vs-main"
          ? defaultBranch
          : head === null
            ? null
            : "HEAD";
  const currentRef =
    activeProjectId === null ? null : preset === "custom" ? customCurrent : WORKTREE_REF;

  const diffQuery = useDiffSummary(activeProjectId, baseRef, currentRef);

  const refsErrorCode = refsQuery.error instanceof AppError ? refsQuery.error.code : null;
  const notGit = refsErrorCode === ErrorCodes.notAGitRepo;
  const noCommits = refsQuery.data !== undefined && refsQuery.data.head === null;

  const refGroups = useMemo(() => buildRefGroups(refs, head, t), [refs, head, t]);
  const worktreeLeading: RefOption[] = [
    { value: WORKTREE_REF, label: t("compare.worktreeOption") },
  ];

  /** A/B swap only makes sense with two explicit refs — the WORKTREE side can't be the base. */
  const canSwap =
    preset === "custom" &&
    customBase !== null &&
    customCurrent !== null &&
    customCurrent !== WORKTREE_REF;

  function handleSwap(): void {
    if (!canSwap) return;
    setCustomBase(customCurrent);
    setCustomCurrent(customBase);
  }

  /** Start a real review run and jump to its report page. */
  function handleRun(): void {
    if (activeProjectId === null || baseRef === null || currentRef === null) return;
    startReview.mutate(
      {
        projectId: activeProjectId,
        baseRef,
        currentRef,
        ...(goal.trim() === "" ? {} : { goal }),
      },
      {
        onSuccess: (response) => {
          toast.success(t("compare.runStarted"));
          void navigate({ to: "/runs/$runId", params: { runId: response.runId } });
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : t("compare.runFailed"));
        },
      },
    );
  }

  function selectionInfo(value: string | null): RefInfo | null {
    if (value === null) return null;
    if (value === WORKTREE_REF) {
      return { mono: "worktree", text: t("compare.worktreeInfo") };
    }
    if (value === "HEAD" && head !== null) {
      return { mono: shortHash(head.commitHash), text: head.subject };
    }
    const ref = refs.find((candidate) => candidate.name === value);
    if (ref !== undefined) {
      return { mono: shortHash(ref.commitHash), text: ref.subject };
    }
    return { mono: value, text: "" };
  }

  const diff = diffQuery.data;
  const panelsDisabled = activeProjectId === null || refsQuery.isPending || notGit || noCommits;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("compare.title")}
        description={t("compare.description")}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/history">
              <History className="size-4" />
              {t("nav.history")}
            </Link>
          </Button>
        }
      />
      <Alert>
        <Info className="size-4" />
        <AlertDescription>{t("compare.banner")}</AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("compare.projectTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              {t("compare.projectPlaceholder")}{" "}
              <Link to="/" className="text-primary underline-offset-4 hover:underline">
                {t("nav.overview")}
              </Link>
            </p>
          ) : (
            <Select value={activeProjectId ?? ""} onValueChange={setActiveProjectId}>
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
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <CardTitle className="text-base">{t("compare.versionsTitle")}</CardTitle>
            {refsQuery.data?.dirty === true && (
              <Badge variant="secondary" className="font-normal text-amber-600 dark:text-amber-400">
                {t("compare.dirtyBadge")}
              </Badge>
            )}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  disabled={activeProjectId === null || refsQuery.isFetching}
                  aria-label={t("common.refresh")}
                  onClick={() => {
                    void refsQuery.refetch();
                    void diffQuery.refetch();
                  }}
                >
                  <RefreshCw className={cn("size-4", refsQuery.isFetching && "animate-spin")} />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("common.refresh")}</TooltipContent>
          </Tooltip>
        </CardHeader>
        <CardContent className="space-y-5">
          <ToggleGroup
            type="single"
            variant="outline"
            value={preset}
            onValueChange={(value) => {
              if (value === "worktree" || value === "vs-main" || value === "custom") {
                setPreset(value);
              }
            }}
            disabled={activeProjectId === null}
          >
            <ToggleGroupItem value="worktree" className="text-[12.5px]">
              {t("compare.presetWorktree")}
            </ToggleGroupItem>
            <ToggleGroupItem value="vs-main" className="text-[12.5px]">
              {t("compare.presetVsMain")}
            </ToggleGroupItem>
            <ToggleGroupItem value="custom" className="text-[12.5px]">
              {t("compare.presetCustom")}
            </ToggleGroupItem>
          </ToggleGroup>

          {notGit && (
            <Alert variant="destructive">
              <TriangleAlert className="size-4" />
              <AlertTitle>{t("compare.notGitTitle")}</AlertTitle>
              <AlertDescription>{t("compare.notGitDescription")}</AlertDescription>
            </Alert>
          )}

          {!notGit && noCommits && (
            <Alert>
              <Info className="size-4" />
              <AlertDescription>{t("compare.noCommits")}</AlertDescription>
            </Alert>
          )}

          {activeProjectId !== null && refsQuery.isPending && <Skeleton className="h-24" />}

          {!panelsDisabled && (
            <div className="grid items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
              <VersionPanel
                label={t("compare.baseLabel")}
                value={baseRef}
                onValueChange={(value) => setCustomBase(value)}
                leading={[]}
                refGroups={refGroups}
                placeholder={t("compare.refPlaceholder")}
                disabled={preset !== "custom"}
                info={selectionInfo(baseRef)}
              />
              {preset === "custom" ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="mx-auto inline-flex">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-8"
                        disabled={!canSwap}
                        aria-label={t("compare.swap")}
                        onClick={handleSwap}
                      >
                        <ArrowLeftRight className="size-4" />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{t("compare.swap")}</TooltipContent>
                </Tooltip>
              ) : (
                <GitCompareArrows className="mx-auto hidden size-4 text-muted-foreground md:block" />
              )}
              <VersionPanel
                label={t("compare.currentLabel")}
                value={currentRef}
                onValueChange={(value) => setCustomCurrent(value)}
                leading={worktreeLeading}
                refGroups={refGroups}
                placeholder={t("compare.refPlaceholder")}
                disabled={preset !== "custom"}
                info={selectionInfo(currentRef)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">{t("compare.diffTitle")}</CardTitle>
          {diff !== undefined && (
            <Badge variant="secondary" className="font-normal">
              {t("compare.diffFiles", { count: diff.filesChanged })}
            </Badge>
          )}
        </CardHeader>
        <CardContent>
          {activeProjectId === null ? (
            <p className="text-[12.5px] text-muted-foreground">{t("compare.selectProjectFirst")}</p>
          ) : refsQuery.isPending ? (
            <Skeleton className="h-24" />
          ) : notGit ? (
            <p className="text-[12.5px] text-muted-foreground">{t("compare.notGitDescription")}</p>
          ) : noCommits ? (
            <p className="text-[12.5px] text-muted-foreground">{t("compare.noCommits")}</p>
          ) : diffQuery.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : diffQuery.isError ? (
            <Alert variant="destructive">
              <TriangleAlert className="size-4" />
              <AlertDescription>
                {diffQuery.error instanceof Error
                  ? diffQuery.error.message
                  : String(diffQuery.error)}
              </AlertDescription>
            </Alert>
          ) : diff !== undefined ? (
            <DiffPreview
              files={diff.files}
              additions={diff.additions}
              deletions={diff.deletions}
              untrackedFiles={diff.untrackedFiles}
            />
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("compare.goalTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder={t("compare.goalPlaceholder")}
            className="min-h-20"
          />
          <div className="flex flex-wrap items-center gap-2">
            {GOAL_SAMPLES.map((key) => (
              <Button
                key={key}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-full px-3 text-xs font-normal text-muted-foreground"
                onClick={() => setGoal(t(key))}
              >
                {t(key)}
              </Button>
            ))}
          </div>
          <p className="text-[12px] text-muted-foreground">{t("compare.goalHint")}</p>
        </CardContent>
      </Card>

      <div className="sticky bottom-6 z-10">
        <Card className="bg-card/95 py-4 shadow-lg backdrop-blur">
          <CardContent className="flex flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <p className="text-[13px] font-medium">
                {diff !== undefined
                  ? t("compare.ready", { count: diff.filesChanged })
                  : activeProjectId === null
                    ? t("compare.selectProjectFirst")
                    : t("compare.runInsufficient")}
              </p>
              <p className="text-[12px] text-muted-foreground">{t("compare.runNote")}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                disabled={
                  activeProjectId === null ||
                  baseRef === null ||
                  currentRef === null ||
                  diff === undefined ||
                  startReview.isPending
                }
                onClick={handleRun}
              >
                {startReview.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
                {startReview.isPending ? t("compare.runStarting") : t("compare.runCta")}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

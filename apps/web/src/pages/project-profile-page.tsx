import type {
  ConventionKind,
  OverrideEntry,
  OverrideKind,
  ProjectProfile,
  ProjectProfileUpdate,
} from "@craftland-qa/contracts";
import { Link } from "@tanstack/react-router";
import { BookOpen, Info, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useProject } from "@/contexts/project-context";
import { formatDateTime } from "@/lib/format";
import { useProjectProfile, useSaveProjectProfile } from "@/lib/use-projects";

const CONVENTION_KINDS: readonly ConventionKind[] = [
  "binding",
  "layout",
  "naming",
  "api-family",
  "other",
];

const CONVENTION_KIND_KEYS: Record<ConventionKind, string> = {
  binding: "projectProfile.conventionKindBinding",
  layout: "projectProfile.conventionKindLayout",
  naming: "projectProfile.conventionKindNaming",
  "api-family": "projectProfile.conventionKindApiFamily",
  other: "projectProfile.conventionKindOther",
};

type PinKind = Extract<OverrideKind, "pin-binding" | "pin-row-key">;

const PIN_KINDS: readonly PinKind[] = ["pin-binding", "pin-row-key"];

const OVERRIDE_KIND_KEYS: Record<OverrideKind, string> = {
  "pin-binding": "projectProfile.pinKindBinding",
  "pin-row-key": "projectProfile.pinKindRowKey",
  "suppress-finding": "projectProfile.overrideKindSuppress",
  "entity-note": "projectProfile.overrideKindNote",
};

function updateOf(profile: ProjectProfile): ProjectProfileUpdate {
  return {
    conventions: profile.conventions,
    readApiFamily: profile.readApiFamily,
    overrides: profile.overrides,
    coverage: profile.coverage,
    editorGenIndex: profile.editorGenIndex,
  };
}

function overrideLine(override: OverrideEntry): string {
  const target =
    override.target.csvPath ??
    override.target.file ??
    override.target.symbolId ??
    override.target.rowKey ??
    "—";
  if (override.kind === "pin-binding" || override.kind === "pin-row-key") {
    return `${target} → ${override.value ?? "—"}`;
  }
  return target;
}

/**
 * Project profile page (E8): conventions, data pins and entity notes are user-pinned
 * *data* the engine reads on the next run. Nothing is auto-accepted here — discovery
 * proposals would need an explicit accept step, and every save replaces the profile
 * atomically so the server keeps `updatedAt` truthful.
 */
export function ProjectProfilePage() {
  const { t } = useTranslation();
  const { projects, activeProject, activeProjectId, isLoading, isError, retry } = useProject();
  const profileQuery = useProjectProfile(activeProjectId);
  const save = useSaveProjectProfile(activeProjectId);

  const [conventionKind, setConventionKind] = useState<ConventionKind>("binding");
  const [conventionStatement, setConventionStatement] = useState("");
  const [conventionFile, setConventionFile] = useState("");

  const [pinKind, setPinKind] = useState<PinKind>("pin-binding");
  const [pinPath, setPinPath] = useState("");
  const [pinValue, setPinValue] = useState("");
  const [pinNote, setPinNote] = useState("");

  const [noteFile, setNoteFile] = useState("");
  const [noteSymbol, setNoteSymbol] = useState("");
  const [noteText, setNoteText] = useState("");

  const profile = profileQuery.data;

  function persist(next: ProjectProfileUpdate): void {
    save.mutate(next);
  }

  function addConvention(): void {
    if (profile === undefined || conventionStatement.trim() === "") return;
    const file = conventionFile.trim();
    persist({
      ...updateOf(profile),
      conventions: [
        ...profile.conventions,
        {
          id: crypto.randomUUID(),
          kind: conventionKind,
          statement: conventionStatement.trim(),
          evidence: file === "" ? [] : [{ file }],
          source: "user",
          createdAt: new Date().toISOString(),
        },
      ],
    });
    setConventionStatement("");
    setConventionFile("");
  }

  function addPin(): void {
    if (profile === undefined || pinPath.trim() === "" || pinValue.trim() === "") return;
    persist({
      ...updateOf(profile),
      overrides: [
        ...profile.overrides,
        {
          id: crypto.randomUUID(),
          kind: pinKind,
          target: { csvPath: pinPath.trim() },
          value: pinValue.trim(),
          ...(pinNote.trim() === "" ? {} : { note: pinNote.trim() }),
          createdAt: new Date().toISOString(),
        },
      ],
    });
    setPinPath("");
    setPinValue("");
    setPinNote("");
  }

  function addNote(): void {
    if (profile === undefined || noteText.trim() === "") return;
    persist({
      ...updateOf(profile),
      overrides: [
        ...profile.overrides,
        {
          id: crypto.randomUUID(),
          kind: "entity-note",
          target: {
            ...(noteFile.trim() === "" ? {} : { file: noteFile.trim() }),
            ...(noteSymbol.trim() === "" ? {} : { symbolId: noteSymbol.trim() }),
          },
          note: noteText.trim(),
          createdAt: new Date().toISOString(),
        },
      ],
    });
    setNoteFile("");
    setNoteSymbol("");
    setNoteText("");
  }

  function removeOverride(id: string): void {
    if (profile === undefined) return;
    persist({
      ...updateOf(profile),
      overrides: profile.overrides.filter((override) => override.id !== id),
    });
  }

  function removeConvention(id: string): void {
    if (profile === undefined) return;
    persist({
      ...updateOf(profile),
      conventions: profile.conventions.filter((convention) => convention.id !== id),
    });
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={TriangleAlert}
            title={t("errors.loadTitle")}
            description={t("errors.loadDescription")}
            action={
              <Button variant="outline" size="sm" onClick={retry}>
                {t("common.retry")}
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  if (projects.length === 0 || activeProject === null) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={t("projectProfile.title")}
          description={t("projectProfile.description")}
        />
        <Card>
          <CardContent>
            <EmptyState
              icon={BookOpen}
              title={t("projectProfile.noProjectTitle")}
              description={t("projectProfile.noProjectDescription")}
              action={
                <Button asChild size="sm">
                  <Link to="/">{t("projectProfile.chooseProject")}</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const pins = (profile?.overrides ?? []).filter(
    (override) => override.kind === "pin-binding" || override.kind === "pin-row-key",
  );
  const notes = (profile?.overrides ?? []).filter(
    (override) => override.kind !== "pin-binding" && override.kind !== "pin-row-key",
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("projectProfile.title")}
        description={`${activeProject.name} · ${t("projectProfile.description")}`}
      />

      {profileQuery.isError ? (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertDescription>
            {profileQuery.error instanceof Error
              ? profileQuery.error.message
              : t("errors.loadDescription")}
            <Button
              variant="outline"
              size="sm"
              className="ml-3"
              onClick={() => void profileQuery.refetch()}
            >
              {t("common.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : profile === undefined ? (
        <Skeleton className="h-48" />
      ) : (
        <>
          <Card>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-body font-semibold">{t("projectProfile.editorGenTitle")}</p>
                <Switch
                  id="profile-editor-gen"
                  checked={profile.editorGenIndex}
                  disabled={save.isPending}
                  onCheckedChange={(checked) =>
                    persist({ ...updateOf(profile), editorGenIndex: checked })
                  }
                />
              </div>
              <p className="text-meta text-muted-foreground">
                {t("projectProfile.editorGenDescription")}
              </p>
              <Separator />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-muted-foreground">
                {profile.coverage === null ? (
                  <span>{t("projectProfile.coverageNone")}</span>
                ) : (
                  <span>
                    {t("projectProfile.coverage", {
                      scripts: profile.coverage.scriptFiles,
                      csv: profile.coverage.csvFiles,
                    })}
                  </span>
                )}
                <span>
                  {t("projectProfile.updatedAt", { time: formatDateTime(profile.updatedAt) })}
                </span>
              </div>
              {save.isError && (
                <p className="text-meta text-danger">
                  {save.error instanceof Error ? save.error.message : t("projectProfile.saveError")}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <p className="text-body font-semibold">{t("projectProfile.conventionsTitle")}</p>
                <p className="text-meta text-muted-foreground">
                  {t("projectProfile.conventionsDescription")}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-[160px_1fr_1fr_auto] sm:items-end">
                <div className="space-y-1">
                  <Label className="text-meta">{t("projectProfile.kind")}</Label>
                  <Select
                    value={conventionKind}
                    onValueChange={(value) => setConventionKind(value as ConventionKind)}
                  >
                    <SelectTrigger className="h-8 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONVENTION_KINDS.map((kind) => (
                        <SelectItem key={kind} value={kind}>
                          {t(CONVENTION_KIND_KEYS[kind])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-meta">{t("projectProfile.statement")}</Label>
                  <Input
                    value={conventionStatement}
                    onChange={(event) => setConventionStatement(event.target.value)}
                    placeholder={t("projectProfile.statementPlaceholder")}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-meta">{t("projectProfile.evidenceFile")}</Label>
                  <Input
                    value={conventionFile}
                    onChange={(event) => setConventionFile(event.target.value)}
                    placeholder={t("projectProfile.evidenceFilePlaceholder")}
                    className="font-mono"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={addConvention}
                  disabled={save.isPending || conventionStatement.trim() === ""}
                >
                  <Plus className="size-3.5" />
                  {t("projectProfile.add")}
                </Button>
              </div>
              {profile.conventions.length === 0 ? (
                <p className="text-meta text-muted-foreground">
                  {t("projectProfile.conventionsEmpty")}
                </p>
              ) : (
                <ul className="space-y-2">
                  {profile.conventions.map((convention) => (
                    <li
                      key={convention.id}
                      className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary" className="font-normal">
                            {t(CONVENTION_KIND_KEYS[convention.kind])}
                          </Badge>
                          <span className="text-body">{convention.statement}</span>
                        </div>
                        {convention.evidence.length > 0 && (
                          <p className="truncate font-mono text-micro text-muted-foreground">
                            {convention.evidence.map((evidence) => evidence.file).join(", ")}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        aria-label={t("projectProfile.remove")}
                        disabled={save.isPending}
                        onClick={() => removeConvention(convention.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <p className="text-body font-semibold">{t("projectProfile.pinsTitle")}</p>
                <p className="text-meta text-muted-foreground">
                  {t("projectProfile.pinsDescription")}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-[170px_1fr_1fr_auto] sm:items-end">
                <div className="space-y-1">
                  <Label className="text-meta">{t("projectProfile.pinType")}</Label>
                  <Select value={pinKind} onValueChange={(value) => setPinKind(value as PinKind)}>
                    <SelectTrigger className="h-8 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PIN_KINDS.map((kind) => (
                        <SelectItem key={kind} value={kind}>
                          {t(OVERRIDE_KIND_KEYS[kind])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-meta">{t("projectProfile.csvPath")}</Label>
                  <Input
                    value={pinPath}
                    onChange={(event) => setPinPath(event.target.value)}
                    placeholder="Assets/CSV/UnitData.csv"
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-meta">
                    {pinKind === "pin-binding"
                      ? t("projectProfile.pinEnum")
                      : t("projectProfile.pinColumn")}
                  </Label>
                  <Input
                    value={pinValue}
                    onChange={(event) => setPinValue(event.target.value)}
                    placeholder={pinKind === "pin-binding" ? "ESpecialUnit" : "id"}
                    className="font-mono"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={addPin}
                  disabled={save.isPending || pinPath.trim() === "" || pinValue.trim() === ""}
                >
                  <Plus className="size-3.5" />
                  {t("projectProfile.add")}
                </Button>
              </div>
              <div className="space-y-1">
                <Label className="text-meta">{t("projectProfile.noteOptional")}</Label>
                <Input
                  value={pinNote}
                  onChange={(event) => setPinNote(event.target.value)}
                  placeholder={t("projectProfile.notePlaceholder")}
                />
              </div>
              {pins.length === 0 ? (
                <p className="text-meta text-muted-foreground">{t("projectProfile.pinsEmpty")}</p>
              ) : (
                <ul className="space-y-2">
                  {pins.map((override) => (
                    <li
                      key={override.id}
                      className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary" className="font-normal">
                            {t(OVERRIDE_KIND_KEYS[override.kind])}
                          </Badge>
                          <code className="truncate font-mono text-meta">
                            {overrideLine(override)}
                          </code>
                        </div>
                        {override.note !== undefined && (
                          <p className="text-meta text-muted-foreground">{override.note}</p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        aria-label={t("projectProfile.remove")}
                        disabled={save.isPending}
                        onClick={() => removeOverride(override.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <p className="text-body font-semibold">{t("projectProfile.notesTitle")}</p>
                <p className="text-meta text-muted-foreground">
                  {t("projectProfile.notesDescription")}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <div className="space-y-1">
                  <Label className="text-meta">{t("projectProfile.noteFile")}</Label>
                  <Input
                    value={noteFile}
                    onChange={(event) => setNoteFile(event.target.value)}
                    placeholder="Assets/Scripts/Systems/..."
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-meta">{t("projectProfile.symbolId")}</Label>
                  <Input
                    value={noteSymbol}
                    onChange={(event) => setNoteSymbol(event.target.value)}
                    placeholder="UnitData.csv#..."
                    className="font-mono"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={addNote}
                  disabled={save.isPending || noteText.trim() === ""}
                >
                  <Plus className="size-3.5" />
                  {t("projectProfile.add")}
                </Button>
              </div>
              <div className="space-y-1">
                <Label className="text-meta">{t("projectProfile.noteText")}</Label>
                <Textarea
                  value={noteText}
                  onChange={(event) => setNoteText(event.target.value)}
                  placeholder={t("projectProfile.noteTextPlaceholder")}
                />
              </div>
              {notes.length === 0 ? (
                <p className="text-meta text-muted-foreground">{t("projectProfile.notesEmpty")}</p>
              ) : (
                <ul className="space-y-2">
                  {notes.map((override) => (
                    <li
                      key={override.id}
                      className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary" className="font-normal">
                            {t(OVERRIDE_KIND_KEYS[override.kind])}
                          </Badge>
                          <code className="truncate font-mono text-micro text-muted-foreground">
                            {overrideLine(override)}
                          </code>
                        </div>
                        <p className="text-meta">{override.note ?? "—"}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        aria-label={t("projectProfile.remove")}
                        disabled={save.isPending}
                        onClick={() => removeOverride(override.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="flex items-start gap-1.5 text-micro text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                {t("projectProfile.notesHint")}
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

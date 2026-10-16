import { Link } from "@tanstack/react-router";
import { GitCompareArrows, History, Info, Play } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/page-header";
import { PhaseBadge } from "@/components/phase-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const GOAL_SAMPLES = ["compare.goalSample1", "compare.goalSample2", "compare.goalSample3"] as const;

interface VersionPanelProps {
  readonly label: string;
  readonly placeholder: string;
  readonly emptyText: string;
}

/** One side of the A/B picker. Disabled until E1 wires real git refs — visual preview only. */
function VersionPanel({ label, placeholder, emptyText }: VersionPanelProps) {
  return (
    <div className="space-y-2">
      <Label className="text-[12.5px]">{label}</Label>
      <Select disabled>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent />
      </Select>
      <div className="rounded-lg border border-border/60 bg-muted/40 p-3 text-[12px] text-muted-foreground">
        {emptyText}
      </div>
    </div>
  );
}

/**
 * Compare screen: pick a project and two revisions (A/B) and run the analysis.
 * The form renders fully but stays disabled until E1 (git refs) and E4 (AI run).
 */
export function ComparePage() {
  const { t } = useTranslation();
  const [goal, setGoal] = useState("");

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
          <Select disabled>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("compare.projectPlaceholder")} />
            </SelectTrigger>
            <SelectContent />
          </Select>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("compare.versionsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <ToggleGroup type="single" variant="outline" defaultValue="worktree" disabled>
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
          <div className="grid items-center gap-4 md:grid-cols-[1fr_auto_1fr]">
            <VersionPanel
              label={t("compare.baseLabel")}
              placeholder={t("compare.refPlaceholder")}
              emptyText={t("compare.refEmpty")}
            />
            <GitCompareArrows className="mx-auto hidden size-4 text-muted-foreground md:block" />
            <VersionPanel
              label={t("compare.currentLabel")}
              placeholder={t("compare.refPlaceholder")}
              emptyText={t("compare.refEmpty")}
            />
          </div>
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
              <p className="text-[13px] font-medium">{t("compare.runInsufficient")}</p>
              <p className="text-[12px] text-muted-foreground">{t("compare.runNote")}</p>
            </div>
            <div className="flex items-center gap-2">
              <PhaseBadge phase="E1/E4" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button disabled>
                      <Play className="size-4" />
                      {t("compare.runCta")}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{t("common.comingSoonPhase", { phase: "E4" })}</TooltipContent>
              </Tooltip>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

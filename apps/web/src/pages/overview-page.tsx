import { FolderPlus, GitCompareArrows, ListChecks, ShieldAlert, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/page-header";
import { PhaseBadge } from "@/components/phase-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const FEATURES = [
  {
    icon: GitCompareArrows,
    titleKey: "overview.features.compareTitle",
    descriptionKey: "overview.features.compareDescription",
  },
  {
    icon: ShieldAlert,
    titleKey: "overview.features.mismatchTitle",
    descriptionKey: "overview.features.mismatchDescription",
  },
  {
    icon: Sparkles,
    titleKey: "overview.features.whatIfTitle",
    descriptionKey: "overview.features.whatIfDescription",
  },
] as const;

const STEPS = [
  {
    icon: FolderPlus,
    titleKey: "overview.step1Title",
    descriptionKey: "overview.step1Description",
  },
  {
    icon: GitCompareArrows,
    titleKey: "overview.step2Title",
    descriptionKey: "overview.step2Description",
  },
  {
    icon: ListChecks,
    titleKey: "overview.step3Title",
    descriptionKey: "overview.step3Description",
  },
] as const;

/**
 * Home screen. With zero projects it shows only onboarding (hero + features + steps) —
 * the project grid and recent activity sections appear once real data exists (E1+).
 */
export function OverviewPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <PageHeader title={t("overview.title")} description={t("overview.description")} />
      <Card>
        <CardContent className="flex flex-col items-center gap-6 py-10 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
            <FolderPlus className="size-5" />
          </div>
          <div className="space-y-1.5">
            <h2 className="text-base font-semibold">{t("overview.startTitle")}</h2>
            <p className="mx-auto max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
              {t("overview.startDescription")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button disabled>
                    <FolderPlus className="size-4" />
                    {t("overview.addProject")}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t("common.comingSoonPhase", { phase: "E1" })}</TooltipContent>
            </Tooltip>
            <PhaseBadge phase="E1" />
          </div>
          <Separator className="max-w-2xl" />
          <div className="grid w-full max-w-3xl gap-4 text-left sm:grid-cols-3">
            {FEATURES.map((feature) => (
              <div
                key={feature.titleKey}
                className="flex flex-col items-start gap-2 rounded-lg border border-border/60 p-4"
              >
                <div className="flex size-8 items-center justify-center rounded-md bg-muted text-foreground">
                  <feature.icon className="size-4" />
                </div>
                <p className="text-[13px] font-semibold">{t(feature.titleKey)}</p>
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  {t(feature.descriptionKey)}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("overview.stepsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <div key={step.titleKey} className="flex items-start gap-3">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {index + 1}
              </div>
              <div className="space-y-0.5">
                <p className="text-[13px] font-semibold">{t(step.titleKey)}</p>
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  {t(step.descriptionKey)}
                </p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

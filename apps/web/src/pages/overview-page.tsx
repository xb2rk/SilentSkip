import { Link } from "@tanstack/react-router";
import { ArrowRight, FolderPlus, GitCompareArrows, ListChecks } from "lucide-react";
import { useTranslation } from "react-i18next";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STEPS = [
  { key: "one", icon: FolderPlus },
  { key: "two", icon: GitCompareArrows },
  { key: "three", icon: ListChecks },
] as const;

/**
 * Home ("Tổng quan"): orientation for designers — what the tool does, the three-step
 * workflow, and the project/run lists that fill in from E1/E4 onward. System health
 * intentionally lives at `/status`, not here.
 */
export function OverviewPage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{t("overview.title")}</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{t("overview.description")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Link to="/compare" className={buttonVariants({ className: "gap-1.5" })}>
            {t("overview.start")}
            <ArrowRight className="size-4" />
          </Link>
          <Link to="/what-if" className={buttonVariants({ variant: "outline" })}>
            {t("overview.ask")}
          </Link>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("overview.steps.title")}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((step) => (
            <Card key={step.key}>
              <CardHeader>
                <step.icon className="size-4 text-muted-foreground" />
                <CardTitle className="text-sm">{t(`overview.steps.${step.key}.title`)}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {t(`overview.steps.${step.key}.description`)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("overview.projects.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t("overview.projects.empty")}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("overview.runs.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t("overview.runs.empty")}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

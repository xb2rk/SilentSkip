import { Compass, Download, FileWarning, Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/page-header";
import { PhaseBadge } from "@/components/phase-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const TOOLS = [
  {
    icon: Languages,
    titleKey: "tools.localizationTitle",
    descriptionKey: "tools.localizationDescription",
    phase: "E9",
  },
  {
    icon: FileWarning,
    titleKey: "tools.contractTitle",
    descriptionKey: "tools.contractDescription",
    phase: "E8",
  },
  {
    icon: Compass,
    titleKey: "tools.conventionTitle",
    descriptionKey: "tools.conventionDescription",
    phase: "E8",
  },
  {
    icon: Download,
    titleKey: "tools.exportTitle",
    descriptionKey: "tools.exportDescription",
    phase: "E10",
  },
] as const;

/** Deep-dive QA tools catalog; each card unlocks at its roadmap phase. */
export function ToolsPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <PageHeader title={t("tools.title")} description={t("tools.description")} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {TOOLS.map((tool) => (
          <Card key={tool.titleKey} className="py-5">
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
                  <tool.icon className="size-5" />
                </div>
                <PhaseBadge phase={tool.phase} />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold">{t(tool.titleKey)}</p>
                <p className="text-body leading-relaxed text-muted-foreground">
                  {t(tool.descriptionKey)}
                </p>
              </div>
              <div className="mt-auto pt-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button variant="outline" size="sm" disabled>
                        {t("tools.open")}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("common.comingSoonPhase", { phase: tool.phase })}
                  </TooltipContent>
                </Tooltip>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

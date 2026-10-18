import { Compass, Download, FileWarning } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const TOOLS = [
  {
    icon: FileWarning,
    titleKey: "tools.contractTitle",
    descriptionKey: "tools.contractDescription",
  },
  {
    icon: Compass,
    titleKey: "tools.conventionTitle",
    descriptionKey: "tools.conventionDescription",
  },
  {
    icon: Download,
    titleKey: "tools.exportTitle",
    descriptionKey: "tools.exportDescription",
  },
] as const;

/** Deep-dive QA tools catalog; each card unlocks in a later release. */
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
                <Badge variant="secondary" className="font-normal text-muted-foreground">
                  {t("common.comingSoon")}
                </Badge>
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
                  <TooltipContent>{t("tools.comingSoonHint")}</TooltipContent>
                </Tooltip>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

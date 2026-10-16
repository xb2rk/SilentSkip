import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";

/** What-If Studio — placeholder until E6 (session memory + evidence-cited answers). */
export function WhatIfPage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("whatIf.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("whatIf.description")}</p>
      </div>
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t("whatIf.placeholder")}
        </CardContent>
      </Card>
    </div>
  );
}

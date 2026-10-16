import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Tools — non-compare utilities (contract writer, localization QA). Planned for E9. */
export function ToolsPage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("tools.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("tools.description")}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("tools.writer.title")}</CardTitle>
          <CardDescription>{t("tools.writer.description")}</CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("tools.localization.title")}</CardTitle>
          <CardDescription>{t("tools.localization.description")}</CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {t("tools.placeholder")}
        </CardContent>
      </Card>
    </div>
  );
}

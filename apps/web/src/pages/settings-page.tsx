import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Settings — language/theme info now; AI connection, allowed roots, editorGen toggles later. */
export function SettingsPage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("settings.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("settings.description")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.language.label")}</CardTitle>
          <CardDescription>{t("settings.language.value")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">{t("settings.themeNote")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.ai.title")}</CardTitle>
          <CardDescription>{t("settings.ai.description")}</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.paths.title")}</CardTitle>
          <CardDescription>{t("settings.paths.description")}</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.editorGen.title")}</CardTitle>
          <CardDescription>{t("settings.editorGen.description")}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

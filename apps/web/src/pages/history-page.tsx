import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";

/** History — placeholder until runs are persisted (E1 storage, E5 full list + compare). */
export function HistoryPage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("history.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("history.description")}</p>
      </div>
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t("history.placeholder")}
        </CardContent>
      </Card>
    </div>
  );
}

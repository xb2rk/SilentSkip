import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";

/** Compare A/B — placeholder until E1 (project registry, git refs, diff collection). */
export function ComparePage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("compare.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("compare.description")}</p>
      </div>
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t("compare.placeholder")}
        </CardContent>
      </Card>
    </div>
  );
}

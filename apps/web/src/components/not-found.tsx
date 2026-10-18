import { Link } from "@tanstack/react-router";
import { Compass } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

/** Fallback screen for unknown routes; keeps users one click away from Home. */
export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="flex size-14 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
        <Compass className="size-6" />
      </div>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{t("common.notFoundTitle")}</h1>
        <p className="max-w-md text-body leading-relaxed text-muted-foreground">
          {t("common.notFoundDescription")}
        </p>
      </div>
      <Button asChild variant="outline">
        <Link to="/">{t("common.notFoundBack")}</Link>
      </Button>
    </div>
  );
}

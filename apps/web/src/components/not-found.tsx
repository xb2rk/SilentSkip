import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { buttonVariants } from "@/components/ui/button";

/** 404 screen (router-level) — keeps users inside the shell instead of a dead end. */
export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 text-center">
      <div className="text-4xl font-semibold">404</div>
      <p className="text-sm text-muted-foreground">{t("notFound.description")}</p>
      <Link to="/" className={buttonVariants({ variant: "outline" })}>
        {t("notFound.back")}
      </Link>
    </div>
  );
}

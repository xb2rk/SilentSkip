import { HealthResponseSchema } from "@craftland-qa/contracts";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchJson } from "@/lib/api";

/**
 * Overview: keeps the web → API → database chain visible (health poll) and reports the
 * running version. Later phases replace the lower half with project selection + last runs.
 */
export function OverviewPage() {
  const { t } = useTranslation();

  const health = useQuery({
    queryKey: ["health"],
    queryFn: async () => HealthResponseSchema.parse(await fetchJson<unknown>("/api/health")),
    refetchInterval: 5000,
  });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("overview.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("overview.description")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("overview.connection")}</CardTitle>
        </CardHeader>
        <CardContent>
          {health.isPending ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : null}
          {health.isError ? (
            <p className="text-sm text-destructive">{t("overview.apiDown")}</p>
          ) : null}
          {health.data ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <dt className="text-muted-foreground">{t("overview.version")}</dt>
              <dd className="font-mono">{health.data.version}</dd>
              <dt className="text-muted-foreground">{t("overview.apiVersion")}</dt>
              <dd className="font-mono">{health.data.apiVersion}</dd>
              <dt className="text-muted-foreground">{t("overview.uptime")}</dt>
              <dd className="font-mono">{health.data.uptimeSeconds}s</dd>
              <dt className="text-muted-foreground">{t("overview.database.label")}</dt>
              <dd>
                <span
                  className={
                    health.data.database === "ok"
                      ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-400"
                      : "rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive"
                  }
                >
                  {t(`overview.database.${health.data.database}`)}
                </span>
              </dd>
            </dl>
          ) : null}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">{t("overview.roadmapHint")}</p>
    </div>
  );
}

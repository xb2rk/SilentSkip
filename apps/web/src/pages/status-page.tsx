import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useHealth } from "@/lib/use-health";
import { cn } from "@/lib/utils";

/** Format seconds as a compact Vietnamese duration, e.g. "2 phút 18 giây". */
function formatUptime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours} giờ`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} phút`);
  }
  parts.push(`${seconds} giây`);
  return parts.join(" ");
}

/**
 * System status (diagnostics): the web → API → database chain. Deliberately not the
 * home page — designers land on `/`, this screen exists for troubleshooting, and the
 * sidebar footer links to it.
 */
export function StatusPage() {
  const { t } = useTranslation();
  const health = useHealth(5000);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{t("status.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("status.description")}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => void health.refetch()}
        >
          <RefreshCw className="size-3.5" />
          {t("common.refresh")}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("status.connection")}</CardTitle>
          {health.data ? (
            <CardDescription>
              {t("status.lastUpdated")}:{" "}
              {new Date(health.data.timestamp).toLocaleTimeString("vi-VN")}
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent>
          {health.isPending ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : null}
          {health.isError ? (
            <p className="text-sm text-destructive">{t("status.apiDown")}</p>
          ) : null}
          {health.data ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <dt className="text-muted-foreground">{t("status.version")}</dt>
              <dd className="font-mono">{health.data.version}</dd>
              <dt className="text-muted-foreground">{t("status.apiVersion")}</dt>
              <dd className="font-mono">{health.data.apiVersion}</dd>
              <dt className="text-muted-foreground">{t("status.uptime")}</dt>
              <dd className="font-mono">{formatUptime(health.data.uptimeSeconds)}</dd>
              <dt className="text-muted-foreground">{t("status.database.label")}</dt>
              <dd>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs",
                    health.data.database === "ok"
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "bg-destructive/15 text-destructive",
                  )}
                >
                  {t(`status.database.${health.data.database}`)}
                </span>
              </dd>
            </dl>
          ) : null}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">{t("status.note")}</p>
    </div>
  );
}

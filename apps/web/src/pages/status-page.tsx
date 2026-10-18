import { cn } from "cn";
import { Info, RefreshCw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { formatUptime } from "@/lib/format";
import { useHealth } from "@/lib/use-health";

interface RowProps {
  readonly label: string;
  readonly children: ReactNode;
}

/** One key/value line in the connection card. */
function Row({ label, children }: RowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

/** Green/red status dot with a text label; never color-only. */
function StatusValue({
  ok,
  okText,
  errorText,
}: {
  readonly ok: boolean;
  readonly okText: string;
  readonly errorText: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cn("inline-block size-2 rounded-full", ok ? "bg-positive" : "bg-danger")}
        aria-hidden="true"
      />
      {ok ? okText : errorText}
    </span>
  );
}

/**
 * Diagnostics screen: connection card polling /api/health (auto-refresh toggle, manual
 * refresh) plus a placeholder for the future log viewer.
 */
export function StatusPage() {
  const { t } = useTranslation();
  const [autoRefresh, setAutoRefresh] = useState(true);
  const health = useHealth(autoRefresh ? 5000 : undefined);
  const data = health.data;

  const apiOk = data?.ok === true;
  const dbOk = data?.database === "ok";

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("status.title")}
        description={t("status.description")}
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={health.isFetching}
            onClick={() => void health.refetch()}
          >
            <RefreshCw className={cn("size-4", health.isFetching && "animate-spin")} />
            {t("common.refresh")}
          </Button>
        }
      />
      {health.isError ? (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertTitle>{t("status.errorTitle")}</AlertTitle>
          <AlertDescription>{t("status.errorDescription")}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="space-y-1">
            <h2 className="pb-1 text-sm font-semibold">{t("status.connectionTitle")}</h2>
            {health.isPending ? (
              <div className="space-y-3 py-2">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-2/3" />
              </div>
            ) : (
              <div className="divide-y divide-border/60 text-body">
                <Row label={t("status.apiLabel")}>
                  <StatusValue
                    ok={apiOk}
                    okText={t("status.online")}
                    errorText={t("status.offline")}
                  />
                </Row>
                <Row label={t("status.databaseLabel")}>
                  <StatusValue
                    ok={dbOk}
                    okText={t("status.online")}
                    errorText={t("status.offline")}
                  />
                </Row>
                <Row label={t("status.versionLabel")}>
                  {data ? `${data.product} v${data.version}` : "—"}
                </Row>
                <Row label={t("status.apiVersionLabel")}>{data?.apiVersion ?? "—"}</Row>
                <Row label={t("status.uptimeLabel")}>
                  {data ? formatUptime(data.uptimeSeconds) : "—"}
                </Row>
                <Row label={t("status.lastUpdatedLabel")}>
                  {data ? new Date(data.timestamp).toLocaleTimeString("vi-VN") : "—"}
                </Row>
              </div>
            )}
            <Separator className="my-3" />
            <div className="flex items-center justify-between gap-3">
              <span className="text-body text-muted-foreground">{t("status.autoRefresh")}</span>
              <Switch
                id="status-auto-refresh"
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
                aria-label={t("status.autoRefresh")}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3">
            <h2 className="text-sm font-semibold">{t("status.diagnosticsTitle")}</h2>
            <EmptyState compact icon={Info} title={t("status.diagnosticsEmpty")} />
            <p className="text-meta leading-relaxed text-muted-foreground">
              {t("status.diagnosticsNote")}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

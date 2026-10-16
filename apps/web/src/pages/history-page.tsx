import { Link } from "@tanstack/react-router";
import { History as HistoryIcon, Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Run history. With no runs the screen intentionally shows only the empty state —
 * the search/filter toolbar and table appear together with real data (E4+).
 */
export function HistoryPage() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <PageHeader title={t("history.title")} description={t("history.description")} />
      <Alert>
        <Info className="size-4" />
        <AlertDescription>{t("history.banner")}</AlertDescription>
      </Alert>
      <Card>
        <CardContent>
          <EmptyState
            icon={HistoryIcon}
            title={t("history.emptyTitle")}
            description={t("history.emptyDescription")}
            action={
              <Button asChild variant="outline" size="sm">
                <Link to="/compare">{t("history.emptyCta")}</Link>
              </Button>
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}

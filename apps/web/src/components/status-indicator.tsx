import { Link } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHealth } from "@/lib/use-health";

/**
 * Header health indicator. Intentionally invisible while the server and database are
 * healthy — it only appears (amber triangle) when something is wrong, linking to /status.
 */
export function StatusIndicator() {
  const { t } = useTranslation();
  const health = useHealth(15000);

  const healthy = health.data?.ok === true && health.data.database === "ok";
  if (health.isPending || healthy) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="size-8 text-amber-600 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-400"
        >
          <Link to="/status" aria-label={t("header.systemIssue")}>
            <TriangleAlert className="size-4" />
          </Link>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{t("header.systemIssue")}</TooltipContent>
    </Tooltip>
  );
}

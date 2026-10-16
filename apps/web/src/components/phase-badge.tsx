import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";

interface PhaseBadgeProps {
  /** Roadmap phase label, e.g. "E1" or "E1/E4". */
  readonly phase: string;
}

/** Marks UI that exists in the layout but is intentionally not wired yet ("Sắp có · E1"). */
export function PhaseBadge({ phase }: PhaseBadgeProps) {
  const { t } = useTranslation();
  return (
    <Badge variant="secondary" className="font-normal text-muted-foreground">
      {t("common.comingSoonPhase", { phase })}
    </Badge>
  );
}

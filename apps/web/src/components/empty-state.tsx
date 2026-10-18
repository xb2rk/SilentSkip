import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description?: string | undefined;
  readonly action?: ReactNode;
  readonly compact?: boolean | undefined;
}

/**
 * Centered empty state with an icon badge, title, description, and an optional action.
 * Use `compact` inside cards/sections where a full-height state would be too loud.
 */
export function EmptyState({ icon: Icon, title, description, action, compact }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center",
        compact ? "py-6" : "py-12",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary",
          compact ? "size-9" : "size-12",
        )}
      >
        <Icon className={compact ? "size-4" : "size-5"} />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? (
          <p className="mx-auto max-w-md text-body leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

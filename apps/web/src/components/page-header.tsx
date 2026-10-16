import type { ReactNode } from "react";

interface PageHeaderProps {
  readonly title: string;
  readonly description?: string | undefined;
  readonly actions?: ReactNode;
}

/**
 * Standard page header: title, one-line description, and optional right-aligned actions.
 * Every screen starts with this so vertical rhythm stays consistent app-wide.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

import type { ReactNode } from "react";

interface PageHeaderProps {
  readonly title: string;
  readonly description?: string | undefined;
  readonly badge?: ReactNode;
  readonly actions?: ReactNode;
}

/**
 * Standard page header: title, optional badge, one-line description, and optional right-aligned actions.
 * Every screen starts with this so vertical rhythm stays consistent app-wide.
 */
export function PageHeader({ title, description, badge, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between pb-3 border-b border-border/40">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          {badge}
        </div>
        {description ? (
          <p className="max-w-3xl text-body leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2 pt-1">{actions}</div> : null}
    </div>
  );
}

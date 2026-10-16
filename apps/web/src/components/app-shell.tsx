import { Link, Outlet } from "@tanstack/react-router";
import {
  Activity,
  GitCompareArrows,
  History,
  LayoutDashboard,
  MessageCircleQuestion,
  Settings,
  Wrench,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ThemeToggle } from "@/components/theme-toggle";

const NAV_ITEMS = [
  { to: "/", labelKey: "app.nav.overview", icon: LayoutDashboard },
  { to: "/compare", labelKey: "app.nav.compare", icon: GitCompareArrows },
  { to: "/what-if", labelKey: "app.nav.whatIf", icon: MessageCircleQuestion },
  { to: "/history", labelKey: "app.nav.history", icon: History },
  { to: "/tools", labelKey: "app.nav.tools", icon: Wrench },
  { to: "/settings", labelKey: "app.nav.settings", icon: Settings },
] as const;

/**
 * Application shell: fixed sidebar navigation + header + main column.
 * The right-hand evidence/What-If panel (E5) will dock into this layout — keeping the
 * shell in one place guarantees every screen inherits it.
 */
export function AppShell() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-dvh bg-background">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card/40">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
            QA
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">{t("app.product")}</div>
            <div className="text-xs text-muted-foreground">{t("app.tagline")}</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-2 py-2">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground data-[status=active]:bg-accent data-[status=active]:text-accent-foreground"
            >
              <item.icon className="size-4" />
              {t(item.labelKey)}
            </Link>
          ))}
        </nav>
        <div className="border-t border-border px-4 py-3">
          <Link
            to="/status"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Activity className="size-3.5" />
            {t("app.statusLink")}
          </Link>
          <div className="mt-2 text-xs text-muted-foreground">{t("app.phase.label")}</div>
          <div className="text-xs">{t("app.phase.value")}</div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-end border-b border-border px-6">
          <ThemeToggle />
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

import { Link } from "@tanstack/react-router";
import { type LucideIcon, Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTheme } from "@/contexts/theme-context";
import type { Theme } from "@/lib/theme";
import { useHealth } from "@/lib/use-health";
import { cn } from "@/lib/utils";

const THEME_OPTIONS: ReadonlyArray<{ value: Theme; icon: LucideIcon; labelKey: string }> = [
  { value: "system", icon: Monitor, labelKey: "app.theme.system" },
  { value: "light", icon: Sun, labelKey: "app.theme.light" },
  { value: "dark", icon: Moon, labelKey: "app.theme.dark" },
];

/** Small "coming in phase X" chip used on cards whose feature is not built yet. */
function ComingSoonBadge({ phase }: { readonly phase: string }) {
  const { t } = useTranslation();
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
      {t("common.comingSoonAt", { phase })}
    </span>
  );
}

/**
 * Settings: theme control (applies immediately via the theme context), language info,
 * diagnostics shortcut, and the phase-labeled placeholders for AI connection, allowed
 * project roots and the editorGen index — wired for real as E1/E4/E8 land.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const health = useHealth();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t("settings.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("settings.description")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.appearance.title")}</CardTitle>
          <CardDescription>{t("settings.appearance.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex max-w-sm gap-1 rounded-lg border border-border bg-muted/40 p-1">
            {THEME_OPTIONS.map((option) => {
              const active = theme === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTheme(option.value)}
                  className={cn(
                    "inline-flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "bg-background font-medium text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <option.icon className="size-4" />
                  {t(option.labelKey)}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.language.label")}</CardTitle>
          <CardDescription>{t("settings.language.value")}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">{t("settings.language.note")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("settings.diagnostics.title")}</CardTitle>
          <CardDescription>{t("settings.diagnostics.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {health.data ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    health.data.database === "ok" ? "bg-emerald-500" : "bg-destructive",
                  )}
                />
                {t("status.database.label")}: {t(`status.database.${health.data.database}`)}
              </span>
              <span className="text-muted-foreground">
                {t("status.version")}: <span className="font-mono">{health.data.version}</span> ·{" "}
                {health.data.apiVersion}
              </span>
            </div>
          ) : health.isError ? (
            <p className="text-sm text-destructive">{t("status.apiDown")}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          )}
          <div>
            <Link to="/status" className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("settings.diagnostics.open")}
            </Link>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {t("settings.ai.title")}
            <ComingSoonBadge phase="E4" />
          </CardTitle>
          <CardDescription>{t("settings.ai.description")}</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {t("settings.paths.title")}
            <ComingSoonBadge phase="E1" />
          </CardTitle>
          <CardDescription>{t("settings.paths.description")}</CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {t("settings.editorGen.title")}
            <ComingSoonBadge phase="E8" />
          </CardTitle>
          <CardDescription>{t("settings.editorGen.description")}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

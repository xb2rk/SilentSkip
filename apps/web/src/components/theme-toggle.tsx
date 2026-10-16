import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/theme-context";
import { resolveTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const CYCLE: readonly Theme[] = ["system", "light", "dark"];

/** Cycles system → light → dark; the icon reflects the effective (resolved) theme. */
export function ThemeToggle({ className }: { readonly className?: string }) {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();

  const label = t(
    theme === "light"
      ? "app.theme.light"
      : theme === "dark"
        ? "app.theme.dark"
        : "app.theme.system",
  );
  const isDark = resolveTheme(theme) === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(className)}
      title={label}
      aria-label={label}
      onClick={() => {
        const nextIndex = (CYCLE.indexOf(theme) + 1) % CYCLE.length;
        setTheme(CYCLE[nextIndex] ?? "system");
      }}
    >
      {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </Button>
  );
}

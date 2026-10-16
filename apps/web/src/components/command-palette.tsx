import { useNavigate } from "@tanstack/react-router";
import {
  Activity,
  GitCompareArrows,
  History,
  LayoutDashboard,
  Monitor,
  Moon,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
  Wrench,
} from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useTheme } from "@/contexts/theme-context";

const PAGES = [
  { to: "/", labelKey: "nav.overview", icon: LayoutDashboard },
  { to: "/compare", labelKey: "nav.compare", icon: GitCompareArrows },
  { to: "/what-if", labelKey: "nav.whatIf", icon: Sparkles },
  { to: "/history", labelKey: "nav.history", icon: History },
  { to: "/tools", labelKey: "nav.tools", icon: Wrench },
  { to: "/status", labelKey: "nav.status", icon: Activity },
  { to: "/settings", labelKey: "nav.settings", icon: SettingsIcon },
] as const;

interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/**
 * Global command palette (Ctrl+K). Also owns two global shortcuts: Ctrl+K toggles the
 * palette and Ctrl+/ jumps straight to What-If. Controlled by AppShell so the header
 * button and the keyboard shortcut share one piece of state.
 */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setTheme } = useTheme();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "/") {
        event.preventDefault();
        void navigate({ to: "/what-if" });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, onOpenChange, open]);

  function goTo(to: (typeof PAGES)[number]["to"]): void {
    onOpenChange(false);
    void navigate({ to });
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder={t("command.placeholder")} />
      <CommandList>
        <CommandEmpty>{t("command.empty")}</CommandEmpty>
        <CommandGroup heading={t("command.groupNavigation")}>
          {PAGES.map((page) => (
            <CommandItem
              key={page.to}
              value={`${t(page.labelKey)} ${page.to}`}
              onSelect={() => goTo(page.to)}
            >
              <page.icon className="size-4" />
              <span>{t(page.labelKey)}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading={t("command.groupAppearance")}>
          <CommandItem value={t("command.themeLight")} onSelect={() => setTheme("light")}>
            <Sun className="size-4" />
            <span>{t("command.themeLight")}</span>
          </CommandItem>
          <CommandItem value={t("command.themeDark")} onSelect={() => setTheme("dark")}>
            <Moon className="size-4" />
            <span>{t("command.themeDark")}</span>
          </CommandItem>
          <CommandItem value={t("command.themeSystem")} onSelect={() => setTheme("system")}>
            <Monitor className="size-4" />
            <span>{t("command.themeSystem")}</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

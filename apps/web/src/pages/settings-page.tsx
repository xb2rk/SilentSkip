import { PRODUCT_VERSION } from "@craftland-qa/contracts";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
  Activity,
  Copy,
  FileCode2,
  Info,
  Monitor,
  Moon,
  Palette,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { PhaseBadge } from "@/components/phase-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTheme } from "@/contexts/theme-context";
import { applyDensity, type Density, persistDensity, readStoredDensity } from "@/lib/density";
import { useHealth } from "@/lib/use-health";

const SECTIONS = [
  { id: "appearance", labelKey: "settings.navAppearance", icon: Palette },
  { id: "ai", labelKey: "settings.navAi", icon: Sparkles },
  { id: "editorGen", labelKey: "settings.navEditorGen", icon: FileCode2 },
  { id: "advanced", labelKey: "settings.navAdvanced", icon: SlidersHorizontal },
  { id: "about", labelKey: "settings.navAbout", icon: Info },
] as const;

type SettingsSection = (typeof SECTIONS)[number]["id"];

/** Display-only path; the real value arrives with the settings API (E4). */
const DB_PATH = "%LOCALAPPDATA%\\CraftlandQA\\data.sqlite";

/**
 * Settings screen: vertical section nav + working appearance controls (theme, density)
 * that apply immediately and persist locally. AI/editorGen sections are laid out but
 * disabled until their roadmap phases wire the backend.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [section, setSection] = useState<SettingsSection>("appearance");
  const [density, setDensity] = useState<Density>(() => readStoredDensity());
  const health = useHealth();

  function handleThemeChange(value: string): void {
    if (value === "light" || value === "dark" || value === "system") {
      setTheme(value);
      toast.success(t("common.saved"));
    }
  }

  function handleDensityChange(value: string): void {
    if (value === "compact" || value === "comfortable") {
      setDensity(value);
      applyDensity(value);
      persistDensity(value);
      toast.success(t("common.saved"));
    }
  }

  async function handleCopyPath(): Promise<void> {
    try {
      await navigator.clipboard.writeText(DB_PATH);
      toast.success(t("common.copied"));
    } catch {
      toast.error(t("common.copyFailed"));
    }
  }

  let content: ReactNode;
  switch (section) {
    case "appearance":
      content = (
        <Card>
          <CardContent className="space-y-5">
            <div className="space-y-1">
              <Label className="text-body font-semibold">{t("settings.themeTitle")}</Label>
              <p className="text-meta text-muted-foreground">{t("settings.themeDescription")}</p>
            </div>
            <ToggleGroup
              type="single"
              variant="outline"
              value={theme}
              onValueChange={handleThemeChange}
              className="w-fit"
            >
              <ToggleGroupItem value="system" className="gap-1.5 px-3 text-body">
                <Monitor className="size-3.5" />
                {t("settings.themeSystem")}
              </ToggleGroupItem>
              <ToggleGroupItem value="light" className="gap-1.5 px-3 text-body">
                <Sun className="size-3.5" />
                {t("settings.themeLight")}
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" className="gap-1.5 px-3 text-body">
                <Moon className="size-3.5" />
                {t("settings.themeDark")}
              </ToggleGroupItem>
            </ToggleGroup>
            <Separator />
            <div className="space-y-1">
              <Label className="text-body font-semibold">{t("settings.densityTitle")}</Label>
              <p className="text-meta text-muted-foreground">{t("settings.densityDescription")}</p>
            </div>
            <ToggleGroup
              type="single"
              variant="outline"
              value={density}
              onValueChange={handleDensityChange}
              className="w-fit"
            >
              <ToggleGroupItem value="comfortable" className="px-3 text-body">
                {t("settings.densityComfortable")}
              </ToggleGroupItem>
              <ToggleGroupItem value="compact" className="px-3 text-body">
                {t("settings.densityCompact")}
              </ToggleGroupItem>
            </ToggleGroup>
            <Separator />
            <div className="space-y-1">
              <Label className="text-body font-semibold">{t("settings.languageTitle")}</Label>
              <p className="text-meta text-muted-foreground">{t("settings.languageDescription")}</p>
            </div>
            <div className="flex w-fit items-center gap-3 rounded-md border border-border/60 px-3 py-2">
              <span className="text-body">{t("settings.languageVi")}</span>
              <Badge variant="secondary" className="font-normal text-muted-foreground">
                {t("settings.languageEn")} · {t("common.comingSoon")}
              </Badge>
            </div>
          </CardContent>
        </Card>
      );
      break;
    case "ai":
      content = (
        <Card>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-body font-semibold">{t("settings.aiTitle")}</Label>
              <PhaseBadge phase="E4" />
            </div>
            <p className="text-meta text-muted-foreground">{t("settings.aiDescription")}</p>
            <div className="space-y-2">
              <Label htmlFor="ai-url" className="text-body">
                {t("settings.aiUrlLabel")}
              </Label>
              <Input
                id="ai-url"
                disabled
                placeholder={t("settings.aiUrlPlaceholder")}
                className="font-mono text-body"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ai-key" className="text-body">
                {t("settings.aiKeyLabel")}
              </Label>
              <Input id="ai-key" type="password" disabled placeholder="••••••••••••" />
            </div>
            <Button variant="outline" size="sm" disabled>
              {t("settings.aiTest")}
            </Button>
          </CardContent>
        </Card>
      );
      break;
    case "editorGen":
      content = (
        <Card>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-body font-semibold">{t("settings.editorGenTitle")}</Label>
              <PhaseBadge phase="E8" />
            </div>
            <p className="text-meta text-muted-foreground">{t("settings.editorGenDescription")}</p>
            <div className="flex items-center gap-3">
              <Switch id="editor-gen" disabled />
              <Label htmlFor="editor-gen" className="text-body text-muted-foreground">
                {t("settings.editorGenToggle")}
              </Label>
            </div>
          </CardContent>
        </Card>
      );
      break;
    case "advanced":
      content = (
        <Card>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label className="text-body font-semibold">{t("settings.advancedDataTitle")}</Label>
              <p className="text-meta text-muted-foreground">
                {t("settings.advancedDataDescription")}
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/40 px-3 py-2">
              <code className="truncate font-mono text-meta">{DB_PATH}</code>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                aria-label={t("common.copy")}
                onClick={() => void handleCopyPath()}
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
            <Separator />
            <div className="space-y-2">
              <Label className="text-body font-semibold">{t("settings.advancedDelete")}</Label>
              <p className="text-meta text-muted-foreground">
                {t("settings.advancedDeleteDescription")}
              </p>
              <Button variant="outline" size="sm" className="text-destructive" disabled>
                {t("settings.advancedDelete")}
              </Button>
            </div>
            <Separator />
            <div className="space-y-2">
              <Label className="text-body font-semibold">{t("settings.advancedToolsTitle")}</Label>
              <p className="text-meta text-muted-foreground">
                {t("settings.advancedToolsDescription")}
              </p>
              <Button asChild variant="outline" size="sm">
                <Link to="/tools">
                  <Wrench className="size-3.5" />
                  {t("nav.tools")}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      );
      break;
    case "about":
      content = (
        <Card>
          <CardContent className="space-y-1">
            <div className="flex items-center justify-between py-2 text-body">
              <span className="text-muted-foreground">{t("settings.aboutVersion")}</span>
              <span className="font-medium tabular-nums">
                {health.data?.version ?? PRODUCT_VERSION}
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between py-2 text-body">
              <span className="text-muted-foreground">{t("settings.aboutApi")}</span>
              <span className="font-mono text-meta">{health.data?.apiVersion ?? "—"}</span>
            </div>
            <Separator />
            <div className="pt-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/status">
                  <Activity className="size-4" />
                  {t("settings.aboutStatus")}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      );
      break;
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("settings.title")} />
      <div className="grid gap-6 md:grid-cols-[200px_1fr]">
        <nav
          aria-label={t("settings.title")}
          className="flex gap-1 overflow-x-auto md:sticky md:top-20 md:flex-col md:self-start"
        >
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              className={cn(
                "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-body transition-colors",
                section === item.id
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <item.icon className="size-4" />
              {t(item.labelKey)}
            </button>
          ))}
        </nav>
        <div className="min-w-0">{content}</div>
      </div>
    </div>
  );
}

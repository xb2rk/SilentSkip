import type { GitHead, GitRef, GitRefKind } from "@silentskip/contracts";
import type { TFunction } from "i18next";
import { GitCommit } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface RefOption {
  readonly value: string;
  readonly label: string;
}

export interface RefGroup {
  readonly labelKey: string;
  readonly options: readonly RefOption[];
}

export interface RefGroups {
  readonly head: RefOption | null;
  readonly groups: readonly RefGroup[];
}

const KIND_GROUP_ORDER: readonly GitRefKind[] = ["branch", "remote", "tag"];

const KIND_GROUP_LABEL_KEYS: Record<GitRefKind, string> = {
  branch: "compare.refGroupBranch",
  remote: "compare.refGroupRemote",
  tag: "compare.refGroupTag",
};

export function buildRefGroups(
  refs: readonly GitRef[],
  head: GitHead | null,
  t: TFunction,
): RefGroups {
  const groups: RefGroup[] = [];
  for (const kind of KIND_GROUP_ORDER) {
    const options = refs
      .filter((ref) => ref.kind === kind)
      .map((ref) => ({ value: ref.name, label: ref.name }));
    if (options.length > 0) {
      groups.push({ labelKey: KIND_GROUP_LABEL_KEYS[kind], options });
    }
  }
  return {
    head: head === null ? null : { value: "HEAD", label: t("compare.headOption") },
    groups,
  };
}

export interface RefInfo {
  readonly mono: string;
  readonly text: string;
}

export interface VersionPanelProps {
  readonly label: string;
  readonly value: string | null;
  readonly onValueChange: (value: string) => void;
  readonly leading: readonly RefOption[];
  readonly refGroups: RefGroups;
  readonly placeholder: string;
  readonly disabled: boolean;
  readonly info: RefInfo | null;
}

export function VersionPanel({
  label,
  value,
  onValueChange,
  leading,
  refGroups,
  placeholder,
  disabled,
  info,
}: VersionPanelProps) {
  const { t } = useTranslation();
  const hasOptions = leading.length > 0 || refGroups.head !== null || refGroups.groups.length > 0;

  return (
    <div className="surface p-4 space-y-3 min-w-0 overflow-hidden">
      <div className="flex items-center justify-between">
        <Label className="text-body font-semibold text-foreground">{label}</Label>
      </div>
      <Select value={value ?? ""} onValueChange={onValueChange} disabled={disabled || !hasOptions}>
        <SelectTrigger className="w-full bg-background font-medium truncate">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {leading.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
          {refGroups.head !== null && (
            <SelectItem value={refGroups.head.value}>{refGroups.head.label}</SelectItem>
          )}
          {refGroups.groups.map((group) => (
            <SelectGroup key={group.labelKey}>
              <SelectLabel>{t(group.labelKey)}</SelectLabel>
              {group.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/30 p-2.5 text-meta min-w-0 overflow-hidden">
        <GitCommit className="size-4 text-primary shrink-0" />
        {info === null ? (
          <span className="text-muted-foreground truncate">{t("compare.refEmpty")}</span>
        ) : (
          <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
            <span className="font-mono text-micro font-semibold rounded bg-background px-1.5 py-0.5 border border-border/80 text-foreground shrink-0">
              {info.mono}
            </span>
            <span className="truncate text-foreground/80 font-medium min-w-0" title={info.text}>
              {info.text || "—"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

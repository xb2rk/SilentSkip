import type { Anchor } from "@silentskip/contracts";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

export interface CopilotOpenOptions {
  readonly projectId?: string | null;
  readonly baseRef?: string | null;
  readonly currentRef?: string | null;
  readonly runId?: string | null;
  readonly initialQuestion?: string;
  readonly targetAnchor?: Anchor | null;
}

interface CopilotContextValue {
  readonly isOpen: boolean;
  readonly options: CopilotOpenOptions | null;
  readonly openCopilot: (opts?: CopilotOpenOptions) => void;
  readonly closeCopilot: () => void;
  readonly toggleCopilot: () => void;
}

const CopilotContext = createContext<CopilotContextValue | null>(null);

export function CopilotProvider({ children }: { readonly children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<CopilotOpenOptions | null>(null);

  const openCopilot = useCallback((opts?: CopilotOpenOptions): void => {
    if (opts !== undefined) {
      setOptions(opts);
    }
    setIsOpen(true);
  }, []);

  const closeCopilot = useCallback((): void => {
    setIsOpen(false);
  }, []);

  const toggleCopilot = useCallback((): void => {
    setIsOpen((prev) => !prev);
  }, []);

  const value = useMemo<CopilotContextValue>(
    () => ({
      isOpen,
      options,
      openCopilot,
      closeCopilot,
      toggleCopilot,
    }),
    [isOpen, options, openCopilot, closeCopilot, toggleCopilot],
  );

  return <CopilotContext.Provider value={value}>{children}</CopilotContext.Provider>;
}

export function useCopilot(): CopilotContextValue {
  const context = useContext(CopilotContext);
  if (context === null) {
    throw new Error("useCopilot must be used within a CopilotProvider");
  }
  return context;
}

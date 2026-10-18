import type { ProjectSummary } from "@craftland-qa/contracts";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useProjects } from "@/lib/use-projects";

/**
 * Active-project state shared across the shell and all pages. Persisted by id in
 * localStorage; when the stored id disappears (project removed) or nothing is stored yet,
 * the first project becomes active automatically so single-project users never have to pick.
 */

const ACTIVE_PROJECT_KEY = "craftland-qa:active-project";

interface ProjectContextValue {
  readonly projects: readonly ProjectSummary[];
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly retry: () => void;
  readonly activeProject: ProjectSummary | null;
  readonly activeProjectId: string | null;
  readonly setActiveProjectId: (id: string | null) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

/** Holds active-project state for the whole app; must wrap the shell and every page. */
export function ProjectProvider({ children }: { readonly children: ReactNode }) {
  const { data, isPending, isError, refetch } = useProjects();
  const projects = useMemo(() => data?.projects ?? [], [data]);
  const [activeProjectId, setActiveId] = useState<string | null>(() => readStoredActiveId());

  const setActiveProjectId = useCallback((id: string | null) => {
    setActiveId(id);
    try {
      if (id === null) {
        window.localStorage.removeItem(ACTIVE_PROJECT_KEY);
      } else {
        window.localStorage.setItem(ACTIVE_PROJECT_KEY, id);
      }
    } catch {
      // localStorage can be unavailable (privacy mode) — in-memory state still works
    }
  }, []);

  useEffect(() => {
    if (isPending) return;
    const ids = projects.map((project) => project.id);
    if (activeProjectId !== null && ids.includes(activeProjectId)) return;
    setActiveProjectId(projects[0]?.id ?? null);
  }, [isPending, projects, activeProjectId, setActiveProjectId]);

  const value = useMemo<ProjectContextValue>(
    () => ({
      projects,
      isLoading: isPending,
      isError,
      retry: refetch,
      activeProject: projects.find((project) => project.id === activeProjectId) ?? null,
      activeProjectId,
      setActiveProjectId,
    }),
    [projects, isPending, isError, refetch, activeProjectId, setActiveProjectId],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

function readStoredActiveId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}

/** Access the active project workspace; throws outside `ProjectProvider`. */
export function useProject(): ProjectContextValue {
  const context = useContext(ProjectContext);
  if (context === null) {
    throw new Error("useProject must be used within ProjectProvider");
  }
  return context;
}

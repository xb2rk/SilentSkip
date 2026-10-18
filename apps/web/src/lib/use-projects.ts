import {
  AddProjectRequestSchema,
  DiffSummarySchema,
  DigestBundleSchema,
  FsListResponseSchema,
  LocalizationReportSchema,
  ProjectListResponseSchema,
  ProjectProfileSchema,
  type ProjectProfileUpdate,
  ProjectRefsResponseSchema,
  ProjectSummarySchema,
} from "@craftland-qa/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api";

/**
 * Project + filesystem browsing queries (E1). Every queryFn parses through its contract
 * schema, so components always receive validated shapes and server drift fails loudly in dev.
 *
 * Freshness windows are tuned for a local tool: long enough that window focus and route
 * changes don't re-run git on every glance, short enough that a fresh commit shows up
 * quickly (Compare also exposes an explicit refresh button for the impatient case).
 */

const PROJECTS_STALE_MS = 15_000;
const GIT_STALE_MS = 15_000;
const FS_STALE_MS = 10_000;

/** All registered projects, newest first. */
export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    staleTime: PROJECTS_STALE_MS,
    queryFn: async () => ProjectListResponseSchema.parse(await fetchJson<unknown>("/api/projects")),
  });
}

/** Head commit + refs + dirty flag for one project; disabled until a project is chosen. */
export function useProjectRefs(projectId: string | null) {
  return useQuery({
    queryKey: ["projects", projectId, "refs"],
    enabled: projectId !== null,
    staleTime: GIT_STALE_MS,
    queryFn: async () =>
      ProjectRefsResponseSchema.parse(await fetchJson<unknown>(`/api/projects/${projectId}/refs`)),
  });
}

/** Real file-level diff between two refs; the `current` side may be the WORKTREE pseudo-ref. */
export function useDiffSummary(
  projectId: string | null,
  baseRef: string | null,
  currentRef: string | null,
) {
  return useQuery({
    queryKey: ["projects", projectId, "diff-summary", baseRef, currentRef],
    enabled: projectId !== null && baseRef !== null && currentRef !== null,
    staleTime: GIT_STALE_MS,
    queryFn: async () =>
      DiffSummarySchema.parse(
        await fetchJson<unknown>(
          `/api/projects/${projectId}/diff-summary?base=${encodeURIComponent(baseRef ?? "")}&current=${encodeURIComponent(currentRef ?? "")}`,
        ),
      ),
  });
}

/** Deterministic digest for a ref range — the change-fact source of the report page (E5). */
export function useDigest(
  projectId: string | null,
  baseRef: string | null,
  currentRef: string | null,
) {
  return useQuery({
    queryKey: ["projects", projectId, "digest", baseRef, currentRef],
    enabled: projectId !== null && baseRef !== null && currentRef !== null,
    staleTime: GIT_STALE_MS,
    queryFn: async () =>
      DigestBundleSchema.parse(
        await fetchJson<unknown>(
          `/api/projects/${projectId}/digest?base=${encodeURIComponent(baseRef ?? "")}&current=${encodeURIComponent(currentRef ?? "")}`,
        ),
      ),
  });
}

/** Deterministic LOC-01 localization report for one ref range (E9). */
export function useLocalization(
  projectId: string | null,
  baseRef: string | null,
  currentRef: string | null,
) {
  return useQuery({
    queryKey: ["projects", projectId, "localization", baseRef, currentRef],
    enabled: projectId !== null && baseRef !== null && currentRef !== null,
    staleTime: GIT_STALE_MS,
    queryFn: async () =>
      LocalizationReportSchema.parse(
        await fetchJson<unknown>(
          `/api/projects/${projectId}/localization?base=${encodeURIComponent(baseRef ?? "")}&current=${encodeURIComponent(currentRef ?? "")}`,
        ),
      ),
  });
}

/** Saved profile for one project — conventions, pins, notes, editorGen flag (E8). */
export function useProjectProfile(projectId: string | null) {
  return useQuery({
    queryKey: ["projects", projectId, "profile"],
    enabled: projectId !== null,
    staleTime: PROJECTS_STALE_MS,
    queryFn: async () =>
      ProjectProfileSchema.parse(await fetchJson<unknown>(`/api/projects/${projectId}/profile`)),
  });
}

/** Replace the profile (server owns projectId/updatedAt); digest queries are invalidated. */
export function useSaveProjectProfile(projectId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProjectProfileUpdate) =>
      ProjectProfileSchema.parse(
        await fetchJson<unknown>(`/api/projects/${projectId}/profile`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }),
      ),
    onSuccess: async (profile) => {
      queryClient.setQueryData(["projects", projectId, "profile"], profile);
      await queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "digest"],
      });
    },
  });
}

/** One directory level for the folder picker; `null` lists the drive roots. */
export function useFsList(path: string | null) {
  return useQuery({
    queryKey: ["fs", path],
    staleTime: FS_STALE_MS,
    queryFn: async () =>
      FsListResponseSchema.parse(
        await fetchJson<unknown>(
          path === null ? "/api/fs/list" : `/api/fs/list?path=${encodeURIComponent(path)}`,
        ),
      ),
  });
}

/** Register a project folder (absolute path); refreshes the project list on success. */
export function useAddProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { readonly rootPath: string; readonly name?: string }) => {
      const body: Record<string, unknown> = { rootPath: input.rootPath };
      if (input.name !== undefined && input.name !== "") {
        body.name = input.name;
      }
      return ProjectSummarySchema.parse(
        await fetchJson<unknown>("/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(AddProjectRequestSchema.parse(body)),
        }),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

/** Unregister a project; refreshes the project list on success. */
export function useRemoveProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (projectId: string) => {
      await fetchJson<unknown>(`/api/projects/${projectId}`, { method: "DELETE" });
      return projectId;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

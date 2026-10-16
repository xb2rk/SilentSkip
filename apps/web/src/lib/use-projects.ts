import {
  AddProjectRequestSchema,
  type AppSettings,
  AppSettingsSchema,
  DetectProjectsResponseSchema,
  DiffSummarySchema,
  ProjectListResponseSchema,
  ProjectRefsResponseSchema,
  ProjectSummarySchema,
  UpdateSettingsRequestSchema,
} from "@craftland-qa/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api";

/**
 * Project + settings queries (E1). Every queryFn parses through its contract schema, so
 * components always receive validated shapes and server drift fails loudly in dev.
 */

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: async () => ProjectListResponseSchema.parse(await fetchJson<unknown>("/api/projects")),
  });
}

export function useProjectRefs(projectId: string | null) {
  return useQuery({
    queryKey: ["projects", projectId, "refs"],
    enabled: projectId !== null,
    queryFn: async () =>
      ProjectRefsResponseSchema.parse(await fetchJson<unknown>(`/api/projects/${projectId}/refs`)),
  });
}

export function useDiffSummary(
  projectId: string | null,
  baseRef: string | null,
  currentRef: string | null,
) {
  return useQuery({
    queryKey: ["projects", projectId, "diff-summary", baseRef, currentRef],
    enabled: projectId !== null && baseRef !== null && currentRef !== null,
    queryFn: async () =>
      DiffSummarySchema.parse(
        await fetchJson<unknown>(
          `/api/projects/${projectId}/diff-summary?base=${encodeURIComponent(baseRef ?? "")}&current=${encodeURIComponent(currentRef ?? "")}`,
        ),
      ),
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async () => AppSettingsSchema.parse(await fetchJson<unknown>("/api/settings")),
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (next: Pick<AppSettings, "allowedRoots">) => {
      const body = UpdateSettingsRequestSchema.parse(next);
      return AppSettingsSchema.parse(
        await fetchJson<unknown>("/api/settings", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["settings"], data);
    },
  });
}

export function useDetectProjects() {
  return useMutation({
    mutationFn: async (rootPath: string) =>
      DetectProjectsResponseSchema.parse(
        await fetchJson<unknown>("/api/projects/detect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rootPath }),
        }),
      ),
  });
}

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

import {
  RunDetailResponseSchema,
  RunListResponseSchema,
  StartReviewRequestSchema,
  StartReviewResponseSchema,
} from "@craftland-qa/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api";

/**
 * Review-run queries (E5). Every queryFn parses through its contract schema, so the report UI
 * always receives validated shapes. The run list is a cheap local read; the run detail polls
 * while the run is not terminal — the SSE stream is the fast path, polling is the fallback.
 */

const RUNS_STALE_MS = 5_000;
const RUN_POLL_MS = 2_000;

/** Run summaries, newest first — optionally narrowed to one project (History page). */
export function useRuns(projectId: string | null) {
  return useQuery({
    queryKey: ["reviews", projectId ?? "all"],
    staleTime: RUNS_STALE_MS,
    refetchInterval: (query) => {
      const runs = query.state.data?.runs ?? [];
      return runs.some((run) => run.status === "queued" || run.status === "running")
        ? RUN_POLL_MS
        : false;
    },
    queryFn: async () =>
      RunListResponseSchema.parse(
        await fetchJson<unknown>(
          projectId === null
            ? "/api/reviews"
            : `/api/reviews?projectId=${encodeURIComponent(projectId)}`,
        ),
      ),
  });
}

/** One run detail; polls every 2s while `queued`/`running`, then stops. */
export function useRun(runId: string | null) {
  return useQuery({
    queryKey: ["reviews", "run", runId],
    enabled: runId !== null,
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "running" ? RUN_POLL_MS : false;
    },
    queryFn: async () =>
      RunDetailResponseSchema.parse(await fetchJson<unknown>(`/api/reviews/${runId}`)),
  });
}

/** Start a review run; the caller navigates to `/runs/:runId` with the returned id. */
export function useStartReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      readonly projectId: string;
      readonly baseRef: string;
      readonly currentRef: string;
      readonly goal?: string;
    }) => {
      const body: Record<string, unknown> = {
        projectId: input.projectId,
        baseRef: input.baseRef,
        currentRef: input.currentRef,
      };
      if (input.goal !== undefined && input.goal.trim() !== "") {
        body.goal = input.goal.trim();
      }
      return StartReviewResponseSchema.parse(
        await fetchJson<unknown>("/api/reviews", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(StartReviewRequestSchema.parse(body)),
        }),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["reviews"] });
    },
  });
}

/** Cancel a running review; refreshes every run query on success. */
export function useCancelReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) =>
      RunDetailResponseSchema.parse(
        await fetchJson<unknown>(`/api/reviews/${runId}/cancel`, { method: "POST" }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["reviews"] });
    },
  });
}

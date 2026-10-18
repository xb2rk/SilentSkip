import { HealthResponseSchema } from "@silentskip/contracts";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/lib/api";

/**
 * Shared health query — one cache entry under `["health"]` for every consumer
 * (status page, settings diagnostics, …) so screens never double-fetch.
 *
 * @param refetchInterval - Auto-refresh interval in ms; omit for on-mount fetching only.
 */
export function useHealth(refetchInterval?: number) {
  return useQuery({
    queryKey: ["health"],
    queryFn: async () => HealthResponseSchema.parse(await fetchJson<unknown>("/api/health")),
    ...(refetchInterval === undefined ? {} : { refetchInterval }),
  });
}

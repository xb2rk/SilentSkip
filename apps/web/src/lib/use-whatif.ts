import {
  AddPinRequestSchema,
  PinListResponseSchema,
  PinSchema,
  StartWhatIfSessionRequestSchema,
  WhatIfSessionDetailResponseSchema,
  WhatIfSessionListResponseSchema,
  type WhatIfStreamEvent,
  WhatIfStreamEventSchema,
} from "@craftland-qa/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { fetchJson } from "./api";

/**
 * What-If data hooks (E6). Sessions and pins are scoped to one A/B comparison
 * (`projectId + baseRef + currentRef`), so every key carries the full scope. Responses are
 * parsed through contract schemas at the boundary, like every other hook in this app.
 */

const WHATIF_STALE_MS = 5_000;
const PENDING_POLL_MS = 1_500;

/** Sessions of one comparison, newest first. */
export function useWhatIfSessions(
  projectId: string | null,
  baseRef: string | null,
  currentRef: string | null,
) {
  return useQuery({
    queryKey: ["whatif", "sessions", projectId ?? "", baseRef ?? "", currentRef ?? ""],
    enabled: projectId !== null,
    staleTime: WHATIF_STALE_MS,
    queryFn: async () => {
      const params = new URLSearchParams({ projectId: projectId ?? "" });
      if (baseRef !== null) params.set("base", baseRef);
      if (currentRef !== null) params.set("current", currentRef);
      return WhatIfSessionListResponseSchema.parse(
        await fetchJson(`/api/whatif/sessions?${params.toString()}`),
      );
    },
  });
}

/** Opens a new conversation for a comparison. */
export function useCreateWhatIfSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { projectId: string; baseRef: string; currentRef: string }) => {
      const body = StartWhatIfSessionRequestSchema.parse(input);
      return WhatIfSessionDetailResponseSchema.parse(
        await fetchJson("/api/whatif/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["whatif", "sessions"] });
    },
  });
}

/** One conversation with its turns; polls while the newest assistant turn is still pending. */
export function useWhatIfSession(sessionId: string | null) {
  return useQuery({
    queryKey: ["whatif", "session", sessionId ?? ""],
    enabled: sessionId !== null,
    staleTime: 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      const lastAssistant = data?.turns.filter((turn) => turn.role === "assistant").at(-1);
      const pending =
        lastAssistant !== undefined &&
        lastAssistant.answer === null &&
        lastAssistant.error === null;
      return pending ? PENDING_POLL_MS : false;
    },
    queryFn: async () =>
      WhatIfSessionDetailResponseSchema.parse(
        await fetchJson(`/api/whatif/sessions/${encodeURIComponent(sessionId ?? "")}`),
      ),
  });
}

/** Asks one question; returns the assistant turn id that will carry the answer. */
export function useAskWhatIf(sessionId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (question: string) => {
      const response = (await fetchJson(
        `/api/whatif/sessions/${encodeURIComponent(sessionId ?? "")}/ask`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question }),
        },
      )) as { turnId: string };
      return response.turnId;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["whatif", "session", sessionId ?? ""] });
    },
  });
}

/**
 * Subscribe to one answer's SSE stream (`GET /api/whatif/turns/:turnId/stream`). Replays
 * buffered events and closes after the terminal event; `useWhatIfSession` polling converges.
 */
export function useWhatIfStream(turnId: string | null): {
  readonly events: readonly WhatIfStreamEvent[];
} {
  const [events, setEvents] = useState<readonly WhatIfStreamEvent[]>([]);

  useEffect(() => {
    setEvents([]);
    if (turnId === null) return;

    const source = new EventSource(`/api/whatif/turns/${encodeURIComponent(turnId)}/stream`);
    const handle = (raw: MessageEvent<string>): void => {
      try {
        const parsed = WhatIfStreamEventSchema.safeParse(JSON.parse(raw.data));
        if (!parsed.success) return;
        const event = parsed.data;
        setEvents((current) => [...current, event]);
        if (event.type !== "stage") source.close();
      } catch {
        // Malformed frame — ignore; polling still converges on the persisted truth.
      }
    };

    for (const name of ["stage", "answer", "failed"]) {
      source.addEventListener(name, handle as EventListener);
    }
    source.onerror = () => source.close();
    return () => source.close();
  }, [turnId]);

  return { events };
}

/** Pins of one comparison. */
export function usePins(
  projectId: string | null,
  baseRef: string | null,
  currentRef: string | null,
) {
  return useQuery({
    queryKey: ["whatif", "pins", projectId ?? "", baseRef ?? "", currentRef ?? ""],
    enabled: projectId !== null && baseRef !== null && currentRef !== null,
    staleTime: WHATIF_STALE_MS,
    queryFn: async () => {
      const params = new URLSearchParams({
        projectId: projectId ?? "",
        base: baseRef ?? "",
        current: currentRef ?? "",
      });
      return PinListResponseSchema.parse(await fetchJson(`/api/whatif/pins?${params.toString()}`));
    },
  });
}

/** Pins one anchor of the comparison (idempotent server-side). */
export function useAddPin(
  projectId: string | null,
  baseRef: string | null,
  currentRef: string | null,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (anchorId: string) => {
      const body = AddPinRequestSchema.parse({
        projectId: projectId ?? "",
        baseRef: baseRef ?? "",
        currentRef: currentRef ?? "",
        anchorId,
      });
      return PinSchema.parse(
        await fetchJson("/api/whatif/pins", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["whatif", "pins"] });
    },
  });
}

/** Removes one pin. */
export function useRemovePin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (pinId: string) => {
      await fetchJson(`/api/whatif/pins/${encodeURIComponent(pinId)}`, { method: "DELETE" });
      return pinId;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["whatif", "pins"] });
    },
  });
}

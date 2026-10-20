"use client";

import { useLive } from "@/lib/hooks/use-fetch";
import type { OrchestrationSummary } from "./orchestration";

/** One shared request for every task row and the Storyboard header (SWR dedupes by key). */
export const ORCHESTRATIONS_KEY = "/api/storyboard/orchestrate";

export interface OrchestrationsResponse {
  orchestrations: OrchestrationSummary[];
  errors: string[];
}

export function useOrchestrations(enabled = true) {
  return useLive<OrchestrationsResponse>(enabled ? ORCHESTRATIONS_KEY : null, { refreshInterval: 30_000 });
}

export function useTaskOrchestration(taskId: string, enabled: boolean): OrchestrationSummary | null {
  const { data } = useOrchestrations(enabled);
  return data?.orchestrations.find((item) => item.taskId === taskId) ?? null;
}

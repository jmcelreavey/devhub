"use client";

import { useEffect } from "react";
import { useLive } from "@/lib/hooks/use-fetch";
import { observeGraphiteMerge } from "@/lib/graphite-theme";
import type { TaskAgentRunSummaries } from "@shared/tasks/agent-runs";

/** One shared SWR key for every task row. */
export const TASK_AGENT_RUNS_KEY = "/api/tasks/agent-runs/summary";

const EMPTY = { handoff: "", latestRun: null } as const;

export function useTaskAgentRuns(taskId: string, enabled = true) {
  const { data } = useLive<{ tasks: TaskAgentRunSummaries }>(enabled ? TASK_AGENT_RUNS_KEY : null);
  const summary = data?.tasks[taskId] ?? EMPTY;
  useEffect(() => {
    if (summary.latestRun) observeGraphiteMerge(summary.latestRun);
  }, [summary.latestRun]);
  return summary;
}

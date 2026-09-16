"use client";

import { useLive } from "@/lib/hooks/use-fetch";
import type { TaskAgentRunSummaries } from "@/lib/tasks/task-agent-runs";

/** One shared SWR key: every task row reads the same response, so N rows cost one poll. */
export const TASK_AGENT_RUNS_KEY = "/api/tasks/agent-runs/summary";

const EMPTY = { handoff: "", latestRun: null } as const;

export function useTaskAgentRuns(taskId: string, enabled = true) {
  const { data } = useLive<{ tasks: TaskAgentRunSummaries }>(enabled ? TASK_AGENT_RUNS_KEY : null, {
    refreshInterval: 15_000,
  });
  return data?.tasks[taskId] ?? EMPTY;
}

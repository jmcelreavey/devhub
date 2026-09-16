/**
 * Heal task↔agent sidecar rows when the agent run store already reached a
 * terminal state but sync was missed (runner writes status.json directly).
 */
import { isActiveAgentRunState } from "@/lib/agent-runs/run-files";
import { readAgentRun } from "@/lib/agent-runs/store";
import {
  getTaskAgentRuns,
  isActiveTaskAgentRunStatus,
  syncTaskAgentRunFromAgentState,
  type TaskAgentRunsFile,
} from "@/lib/tasks/task-agent-runs";

export async function reconcileTaskAgentRunSidecar(
  taskId: string,
  notesDir?: string,
): Promise<TaskAgentRunsFile> {
  const file = getTaskAgentRuns(taskId, notesDir);
  let changed = false;
  for (const record of file.runs) {
    if (!isActiveTaskAgentRunStatus(record.status)) continue;
    const agent = readAgentRun(record.runId);
    if (!agent) {
      await syncTaskAgentRunFromAgentState(record.runId, "cancelled", { notesDir });
      changed = true;
      continue;
    }
    if (!isActiveAgentRunState(agent.status.state)) {
      await syncTaskAgentRunFromAgentState(record.runId, agent.status.state, {
        sessionId: agent.status.sessionId ?? null,
        terminalSessionId: agent.status.terminalSessionId ?? null,
        provider: agent.spec.provider,
        notesDir,
      });
      changed = true;
    }
  }
  return changed ? getTaskAgentRuns(taskId, notesDir) : file;
}

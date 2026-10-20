import { isActiveAgentRunState } from "@/lib/agent-runs/run-files";
import { readAgentRun } from "@/lib/agent-runs/store";
import { listTaskAgentRuns, isActiveTaskAgentRunStatus } from "@/lib/tasks/task-agent-runs";
import { TaskIdSchema } from "./schema";
import { readNotesBoard } from "./notes-board";
import { hasLiveWork } from "./next-action";
import { acknowledgeFailure } from "./failure-acknowledgements";
import { retryOrchestration } from "./orchestrator";
import { resumeTaskAgent } from "@/lib/tasks/resume-task-agent";
import { StoryboardError } from "./errors";
import { withPluginMutationLock } from "@/lib/plugins/lock";
import { getNotesDir } from "@/lib/notes/dir";
import path from "node:path";

export interface FailureRecoveryInput {
  taskId: string;
  key: string;
  action: "clear" | "restore" | "retry" | "resume";
  guidance?: string;
}

export async function recoverFailure(input: FailureRecoveryInput, origin: string): Promise<{ execute?: () => Promise<void> }> {
  TaskIdSchema.parse(input.taskId);
  return withPluginMutationLock(path.join(getNotesDir(), ".config", "storyboard", ".locks", `recovery-${input.taskId}`), async () => {
    const card = readNotesBoard({ doneWindowDays: null }).cards.find((item) => item.taskId === input.taskId);
    if (!card) throw new StoryboardError("Task not found in this profile.", 404);
    const runs = listTaskAgentRuns(card.taskId);
    const live = runs.some((run) => { const saved = readAgentRun(run.runId); return isActiveTaskAgentRunStatus(run.status) || (saved && isActiveAgentRunState(saved.status.state)); });
    if (card.taskDone || hasLiveWork(card) || live) throw new StoryboardError("This task finished or has live work. Refresh before acting.", 409);
    if (!card.failure || card.failure.key !== input.key) throw new StoryboardError("The failure changed. Refresh before acting.", 409);
    if (input.action === "clear" || input.action === "restore") {
      await acknowledgeFailure(input.taskId, input.action === "clear" ? input.key : null);
      return {};
    }
    if (input.action === "resume" && !input.guidance?.trim()) throw new StoryboardError("Add guidance before sending.", 400);
    if (card.auto) {
      const result = await retryOrchestration({ action: "retry", taskId: card.taskId, idempotencyKey: `recovery-${crypto.randomUUID()}`, ...(input.guidance ? { guidance: input.guidance } : {}) }, { origin });
      return result.execute ? { execute: result.execute } : {};
    }
    if (!card.failure.runId) throw new StoryboardError("No failed run is available to retry.", 409);
    await resumeTaskAgent({ taskId: card.taskId, date: card.date, origin, retryRunId: card.failure.runId, guidance: input.guidance });
    return {};
  });
}

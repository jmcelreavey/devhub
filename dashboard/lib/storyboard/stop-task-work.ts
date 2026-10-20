import { setTimeout as delay } from "node:timers/promises";
import { cancelAgentRun, readAgentRun, reconcileAgentRun } from "@/lib/agent-runs/store";
import { isActiveAgentRunState } from "@/lib/agent-runs/run-files";
import { cancelManagedRun, reconcileManagedRun } from "@/lib/paseo/lifecycle";
import { listTaskAgentRuns, isActiveTaskAgentRunStatus, upsertTaskAgentRun } from "@/lib/tasks/task-agent-runs";
import { mutateOrchestration, readOrchestration } from "./orchestration-store";
import { StoryboardError } from "./errors";

/** The task's runs that are still live, by its own record or by the run's saved state. */
export function activeTaskRuns(taskId: string) {
  return listTaskAgentRuns(taskId).filter((run) => {
    const saved = readAgentRun(run.runId);
    return isActiveTaskAgentRunStatus(run.status) || !!saved && isActiveAgentRunState(saved.status.state);
  });
}

/**
 * Pause auto and stop every live run through its owning runtime, waiting until each has
 * stopped. Throws (and leaves the task as it was) when a run will not stop. The worktree,
 * the note and run history are kept.
 */
export async function stopTaskWork(taskId: string, runs = activeTaskRuns(taskId)): Promise<void> {
  const auto = readOrchestration(taskId);
  if (auto && auto.status !== "paused-manual" && auto.status !== "stopped") await mutateOrchestration(taskId, null, (record) => record ? { ...record, status: "paused-manual" } : null);
  for (const record of runs) {
    await stopTaskAgentRun(record.runId);
    await upsertTaskAgentRun({ ...record, taskId, status: "abandoned" });
  }
}

/** A cancellation signal is not proof that the process has stopped using its checkout. */
export async function stopTaskAgentRun(runId: string): Promise<void> {
  let run = readAgentRun(runId);
  if (!run) throw new StoryboardError("A run is still marked active but its state is unavailable. Stop it in Agents first.", 409);
  if (!isActiveAgentRunState(run.status.state)) return;
  if (run.spec.runtime === "generation") throw new StoryboardError("This generation is still running. Wait for it to finish before resetting.", 409);
  const managed = run.spec.runtime === "paseo" || run.spec.runtime === "aionui";
  try {
    if (managed) await cancelManagedRun(run);
    else cancelAgentRun(run);
  } catch (error) {
    throw new StoryboardError(`Could not stop the agent. Nothing else changed: ${error instanceof Error ? error.message : "Unknown cancellation error"}`, 409);
  }
  const deadline = Date.now() + 10_000;
  do {
    run = managed ? await reconcileManagedRun(run) : reconcileAgentRun(readAgentRun(runId) ?? run);
    if (!isActiveAgentRunState(run.status.state)) return;
    await delay(250);
  } while (Date.now() < deadline);
  throw new StoryboardError("Stop requested, but the agent is still running. Nothing else changed; try again once it stops.", 409);
}

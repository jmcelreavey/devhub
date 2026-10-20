/**
 * Plan-only run for a task: the Plan dialog's "Write plan with agent", without a human at the launch sheet.
 * One `plan` agent run investigates and writes the plan into the task note, then stops. It never starts
 * auto mode and the prompt forbids code changes, so nothing follows it until someone starts the task.
 */
import { AgentDispatchError, dispatchAgentRun } from "@/lib/agent-runs/dispatch";
import { toAgentRunSummary, type AgentRunSummary } from "@/lib/agent-runs/store";
import { resolveLocalGithubRepos } from "@/lib/repos/resolution";
import { readOrchestration } from "@/lib/storyboard/orchestration-store";
import { buildTaskPlanPrompt } from "@/lib/tasks/implement-prompt";
import { selectTaskImplementationRepo } from "@/lib/tasks/implement-repo";
import { reconcileTaskAgentRunSidecar } from "@/lib/tasks/reconcile-task-agent-sidecar";
import { ensureTasksMigrated, getTasks } from "@/lib/tasks/storage";
import { getTaskAgentHandoff, isActiveTaskAgentRunStatus } from "@/lib/tasks/task-agent-runs";

export class TaskAgentPlanError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "TaskAgentPlanError";
  }
}

export interface PlanTaskAgentInput {
  taskId: string;
  date: string;
  origin: string;
  /** Agent id; blank or "default" uses the plan tier's choice, else the preferred provider. */
  provider?: string;
  model?: string;
  effort?: string;
  /** Wins over the task's linked repo. */
  cwd?: string;
  repoName?: string;
  /** Caller's nesting level; dispatch refuses an agent that is already too deep. */
  depth?: number;
}

export async function planTaskAgent(input: PlanTaskAgentInput): Promise<{ run: AgentRunSummary }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new TaskAgentPlanError("date must be YYYY-MM-DD", 400);
  await ensureTasksMigrated();
  const task = getTasks(input.date).find((item) => item.id === input.taskId);
  if (!task) throw new TaskAgentPlanError(`Task ${input.taskId} not found on ${input.date}`, 404);
  if (task.done || task.abandonedAt) throw new TaskAgentPlanError("That task is closed. Reopen it before planning it.", 409);

  await reconcileTaskAgentRunSidecar(input.taskId);
  const latest = getTaskAgentHandoff(input.taskId).latestRun;
  if (latest && isActiveTaskAgentRunStatus(latest.status)) {
    throw new TaskAgentPlanError(`Run ${latest.runId} is still ${latest.status} — wait for it or cancel it first.`, 409);
  }
  const orchestration = readOrchestration(input.taskId);
  if (orchestration && (orchestration.status === "starting" || orchestration.status === "running")) {
    throw new TaskAgentPlanError("This task is already on auto, which plans it itself.", 409);
  }

  const repoName = input.repoName ?? task.links?.find((link) => link.kind === "repo")?.id;
  let cwd = input.cwd?.trim() || task.teamPickup?.cwd;
  if (!cwd && repoName) {
    const local = selectTaskImplementationRepo(repoName.toLowerCase(), await resolveLocalGithubRepos().catch(() => []));
    cwd = local?.repo.path;
  }
  if (!cwd) throw new TaskAgentPlanError("Cannot plan: link a repo to the task (or pass cwd) so the agent has a checkout to read.", 400);

  try {
    const run = await dispatchAgentRun({
      provider: input.provider && input.provider !== "default" ? input.provider : "",
      ...(input.model ? { model: input.model } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
      prompt: `${buildTaskPlanPrompt({ origin: input.origin, taskId: input.taskId, date: input.date, cwd, repoName, jiraKey: task.jiraKey })}\nThis run has a task-scoped MCP peer: use task_plan_context first, then task_plan_update to save only Plan, Acceptance and Open questions on this task. These instructions override the skill's notes_write and tasks_set_stage steps. Do not call other write APIs or tools; report readiness rather than changing the task stage.`,
      cwd,
      title: `Plan ${task.text}`.slice(0, 80),
      // Read only, in the repo checkout, exactly like the Plan dialog.
      worktree: false,
      planScope: { taskId: input.taskId, date: input.date },
      depth: input.depth ?? 0,
      activity: { source: "interactive", action: "plan", taskId: input.taskId, taskDate: input.date, ...(repoName ? { repoName } : {}) },
    });
    return { run: toAgentRunSummary(run) };
  } catch (error) {
    if (error instanceof AgentDispatchError) throw new TaskAgentPlanError(error.message, error.status);
    throw error;
  }
}

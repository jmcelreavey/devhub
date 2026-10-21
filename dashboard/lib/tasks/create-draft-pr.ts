import { dispatchAgentRun, AgentDispatchError } from "@/lib/agent-runs/dispatch";
import { runGitRepoAsync } from "@/lib/git/repo-local";
import { buildAutoDraftPrPrompt } from "@/lib/tasks/auto-prompts";
import { ensureTasksMigrated, getTasks } from "@/lib/tasks/storage";
import { implementationForTask } from "@/lib/workflows/service";

export class CreateDraftPrError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

/**
 * "Approve and create PR" for a task whose work was reviewed: the same draft-PR step auto mode runs, started from the
 * task's own implementation checkout so it works for tasks that were never on auto. The agent opens the draft and tags
 * the PR on the task note, which is what turns the row's button into the check.
 */
export async function createDraftPrForTask(input: { taskId: string; date: string; origin: string }): Promise<{ runId: string }> {
  await ensureTasksMigrated();
  const task = getTasks(input.date).find((item) => item.id === input.taskId);
  if (!task) throw new CreateDraftPrError("That task could not be found on that day.", 404);
  if (task.done || task.abandonedAt) throw new CreateDraftPrError("That task is closed.");
  const repoName = task.links?.find((link) => link.kind === "repo")?.id;
  let implementation: ReturnType<typeof implementationForTask>;
  try { implementation = implementationForTask(input.taskId); }
  catch { throw new CreateDraftPrError("There is no implementation checkout to open a PR from. Run the implementation first."); }
  const { run, cwd } = implementation;
  const branch = (await runGitRepoAsync(cwd, ["branch", "--show-current"])).stdout.trim() || run.spec.worktree?.branch;
  try {
    const dispatched = await dispatchAgentRun({
      requestId: `create-pr-${input.taskId}-${Date.now().toString(36)}`,
      provider: "",
      prompt: buildAutoDraftPrPrompt({ origin: input.origin, taskId: task.id, date: input.date, ...(repoName ? { repoName } : {}), ...(task.jiraKey ? { jiraKey: task.jiraKey } : {}), cwd, ...(branch ? { branch } : {}) }),
      cwd,
      worktree: false,
      ...(run.spec.worktree ? { inherit: { worktree: run.spec.worktree, ...(run.spec.baseSha ? { baseSha: run.spec.baseSha } : {}) } } : {}),
      title: `Open PR ${task.text}`,
      depth: 0,
      activity: { source: "interactive", action: "create-pr", taskId: task.id, taskDate: input.date, ...(repoName ? { repoName } : {}) },
    });
    return { runId: dispatched.spec.id };
  } catch (error) {
    if (error instanceof AgentDispatchError) throw new CreateDraftPrError(error.message, error.status);
    throw error;
  }
}

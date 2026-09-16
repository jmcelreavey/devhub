export interface TaskImplementPromptInput {
  /** Dashboard origin, e.g. http://localhost:1337. */
  origin: string;
  taskId: string;
  date: string;
  repoName?: string;
  cwd?: string;
  jiraKey?: string;
}

export function taskImplementPlanUrl(input: TaskImplementPromptInput): string {
  return `${input.origin.replace(/\/$/, "")}/api/tasks/implement/plan?taskId=${encodeURIComponent(input.taskId)}&date=${encodeURIComponent(input.date)}`;
}

export function buildTaskImplementPrompt(input: TaskImplementPromptInput): string {
  const planUrl = taskImplementPlanUrl(input);
  const repo = input.repoName ? ` in the ${input.repoName} repo` : "";
  const lines = [
    `Use the devhub-implement-task skill to implement this DevHub task end-to-end${repo}.`,
    `Plan URL (curl it first - tags, linked notes/repos, Jira ticket, note path): ${planUrl}`,
  ];
  if (input.cwd) lines.push(`Working tree: ${input.cwd}. Stay in this checkout.`);
  if (input.jiraKey) lines.push(`Jira ticket: ${input.jiraKey}.`);
  lines.push(
    "Use the existing local repo checkout DevHub starts you in. Do not create a clone or worktree by default; switch/create the task branch in a clean checkout. If unrelated dirty work makes that unsafe, ask before using a worktree.",
    "The DevHub notes MCP is available for the task note, tag lookups (tags_lookup), Jira (jira_ticket_get / jira_ticket_transition), and updating the task.",
    "Work interactively: ask me before each post-implementation step (commit/push, PR, PR review note, Jira transition, completing the task). Never commit without asking.",
  );
  return lines.join("\n");
}

/**
 * Turn a draft into a plan an agent can run without design questions. Uses a
 * reasoning-heavy pass; implementation happens later, from the ready task.
 */
export function buildTaskPlanPrompt(input: TaskImplementPromptInput): string {
  const planUrl = taskImplementPlanUrl(input);
  const lines = [
    "Use the devhub-plan-write skill to turn this DevHub draft task into a plan. Do not implement it.",
    `Plan URL (curl it first - task, note path, links, Jira, context): ${planUrl}`,
  ];
  if (input.cwd) lines.push(`Repo checkout for investigation: ${input.cwd}. Read only — no commits, no branches.`);
  if (input.jiraKey) lines.push(`Jira ticket: ${input.jiraKey}.`);
  lines.push(
    "Write the result into the task note: ## Plan (the change, the files, the commands that prove it worked) and ## Acceptance. Put anything only I can answer under ## Open questions as unchecked boxes.",
    `When nothing is left open, mark the task ready: POST ${input.origin.replace(/\/$/, "")}/api/tasks/stage with {"taskId":"${input.taskId}","date":"${input.date}","stage":"ready"} (409 lists what's still missing). Otherwise leave it as a draft and tell me the questions.`,
  );
  return lines.join("\n");
}

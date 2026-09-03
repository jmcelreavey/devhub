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

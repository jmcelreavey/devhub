import { taskImplementPlanUrl } from "@/lib/tasks/implement-prompt";

export interface ImplementReviewPromptInput {
  /** Dashboard origin, e.g. http://localhost:1337. */
  origin: string;
  taskId: string;
  date: string;
  taskText: string;
  /** The implementation checkout or worktree. */
  cwd: string;
  /** Where the review is saved, e.g. `pr-reviews/payments-api-pay-482`. */
  notePath: string;
  repoName?: string;
  jiraKey?: string;
  branch?: string;
  base?: string;
}

/**
 * Prompt for the assistant that reviews another agent's finished implementation.
 * The reviewer reads and writes a note; it never changes the code, so the
 * implementer stays the only author of the diff.
 */
export function buildImplementReviewPrompt(input: ImplementReviewPromptInput): string {
  const planUrl = taskImplementPlanUrl({
    origin: input.origin,
    taskId: input.taskId,
    date: input.date,
    repoName: input.repoName,
  });
  const lines = [
    "Use the pr-explain-review skill in local pre-PR mode to review an implementation that another agent has just finished. You are the reviewer, not the implementer.",
    `Task: ${input.taskText}${input.jiraKey ? ` (${input.jiraKey})` : ""}.`,
    `Plan URL (curl it first - task, Jira ticket, linked notes): ${planUrl}`,
    `Checkout under review: ${input.cwd}. Read it, and run read-only git commands there. Do not edit files, stage, commit, push, stash or switch branches, and do not post anything to GitHub or Jira.`,
  ];
  if (input.branch) lines.push(`Implementation branch: ${input.branch}.`);
  if (input.base) lines.push(`Intended remote base: ${input.base}.`);
  lines.push(
    `Save the review as the DevHub note ${input.notePath} (create it, or replace its body if it exists). Its ## Links section must carry a **Repo:** backlink to the local clone folder and a **Task:** backlink for task id ${input.taskId} dated ${input.date}.`,
    "Finish by replying with the verdict and a numbered list of must-fix findings, each with a file and line. If there are none, say so.",
  );
  return lines.join("\n");
}

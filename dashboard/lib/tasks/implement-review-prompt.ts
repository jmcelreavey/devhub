import { TASK_STATUS_UPDATE_INSTRUCTION } from "@shared/task-note/status-update.ts";
import { OWNER_NOTES_INSTRUCTION } from "./owner-notes";
import { taskImplementPlanUrl } from "@/lib/tasks/implement-prompt";

/** The reviewer is read-only on code, but the task note is how its verdict reaches the board. */
export const REVIEW_TASK_NOTE_LINE =
  OWNER_NOTES_INSTRUCTION + " " +
  TASK_STATUS_UPDATE_INSTRUCTION + " " +
  "Task note: record the review on it with the task_note_update MCP tool as you go: add_bug for each must-fix finding (with severity and file:line in details), set_bug_status fixed for earlier bugs this diff resolves, add_decision for any trade-off you accept, and append_log with the verdict. Tidy what you touch (remove_item for duplicate or stale bugs). Keep the workflow column unchanged; update the structured status summary with your verdict and next step.";

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
    "Also follow the code-review skill on this same diff. The spec is this task and its Jira ticket. Put its reports in this same note under ## Standards and ## Spec, and leave those two sections separate from the other findings.",
    `${REVIEW_TASK_NOTE_LINE} Task id ${input.taskId}, date ${input.date}.`,
    "Finish by replying with the verdict and a numbered list of must-fix findings, each with a file and line. If there are none, say so.",
  );
  return lines.join("\n");
}

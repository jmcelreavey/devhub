import { TASK_STATUS_UPDATE_INSTRUCTION } from "@shared/task-note/status-update.ts";
export interface CreatePrPromptInput {
  repoName: string;
  jiraKey?: string;
  taskId?: string;
  date?: string;
}

export function buildCreatePrPrompt(input: CreatePrPromptInput): string {
  const lines = [
    `Use the create-pr skill to create a GitHub pull request for the ${input.repoName} repo.`,
  ];
  if (input.jiraKey) lines.push(`Jira ticket: ${input.jiraKey}.`);
  if (input.taskId && input.date) {
    lines.push(
      `DevHub task id ${input.taskId} on ${input.date} — pass that exact id/date through the skill's DevHub sync step.`,
      TASK_STATUS_UPDATE_INSTRUCTION,
      "Task note: once the PR exists, update it with the task_note_update MCP tool: set_status ready-for-review (draft-pr only if John explicitly asked for a draft), set_meta addLinks with the PR, and set_status_update with what the PR does. Tidy stale items while you are there.",
    );
  }
  lines.push(
    "Work interactively: ask any questions the skill requires (title, base branch, whether to commit/push, Jira mutations) before changing git or GitHub.",
    "Open the PR ready for review: no `--draft` unless John explicitly asks for a draft PR.",
    "Do not silently run `gh pr create` with a guessed title. Uncommitted work is allowed; the skill can refuse or ask what to do.",
  );
  return lines.join("\n");
}

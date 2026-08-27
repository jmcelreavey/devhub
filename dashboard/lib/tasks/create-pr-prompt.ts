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
    );
  }
  lines.push(
    "Work interactively: ask any questions the skill requires (title, base branch, draft vs open, whether to commit/push, Jira mutations) before changing git or GitHub.",
    "Do not silently run `gh pr create` with a guessed title. Uncommitted work is allowed; the skill can refuse or ask what to do.",
  );
  return lines.join("\n");
}

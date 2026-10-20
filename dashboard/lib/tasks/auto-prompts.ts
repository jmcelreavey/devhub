import { TASK_NOTE_MAINTENANCE_LINE, taskImplementPlanUrl, type TaskImplementPromptInput } from "./implement-prompt";

/**
 * Prompts for Storyboard auto mode (lib/storyboard/auto-mode.ts). John's
 * "Start on auto" click is the go-ahead for the whole loop up to a draft PR,
 * so these runs don't stop to ask before each git step the way the
 * interactive implement prompt does. They still stop for anything only John
 * can answer: an open question in the task note pauses auto mode at Needs you.
 */

export const AUTO_MODE_LINE =
  "DevHub auto mode: John started this task on auto, which approves implementing it, committing on a task branch and opening a draft PR. Do not ask before those steps. Never merge, never mark the PR ready for review, never push to the default branch, and never touch Jira. Everything you change (files, commits, branches) stays inside this task's repo checkout. Reading is not limited to it: you may read any other repo in John's repos folder, clone another repo from the same git organisation when the work needs to look at it (the repos_clone tool, or `gh repo clone` / `git clone` into the repos folder next to this one), and bring such a clone up to date on its default branch (`git fetch` then `git pull --ff-only`). Never edit, commit or push in those other repos, and do not ask before reading or cloning them. If something only John can answer blocks you, add_question on the task note (pass options with the short answers you would offer, so he can pick one) and stop: DevHub pauses at Needs you and resumes when he answers. Lines in the plan or note that ask for John\'s approval before local verification (native builds, simulators, test runs, installing dependencies in the working tree) are already satisfied: go ahead without asking. How to verify is your call, not John's: choose the most automated option that stays in the working tree (an app-local Maestro or Detox flow, a test seam, a script, an emulator or simulator you can drive) and use it without asking. If a check genuinely can't be automated from here, record it in the note as a remaining manual check with the exact steps, and carry on with the rest instead of stopping to ask. Stop only for credentials, spending money, publishing, pushing to shared branches, or anything destructive outside the working tree. DevHub starts the next step itself when you finish.";

export function buildAutoImplementPrompt(input: TaskImplementPromptInput & { skipPlan?: boolean }): string {
  const lines = [
    `Use the devhub-implement-task skill to implement this DevHub task end to end${input.repoName ? ` in the ${input.repoName} repo` : ""}, following the plan in its task note.`,
    `Plan URL (curl it first - linked notes/repos, Jira ticket, note path): ${taskImplementPlanUrl(input)}`,
  ];
  if (input.cwd) lines.push(`Working tree: ${input.cwd}. Stay in it.`);
  if (input.jiraKey) lines.push(`Jira ticket: ${input.jiraKey} (read only).`);
  if (input.skipPlan) lines.push("Planning was skipped on purpose, so the note has no plan. Read the task and its Jira ticket, write a short ## Plan and ## Acceptance into the task note yourself as you start, then implement it.");
  lines.push(
    AUTO_MODE_LINE,
    "Create or switch to a task branch (never the default branch), implement the plan, run the repo's own checks (lint, typecheck, tests) until they pass, and commit with a clear message. Do not push and do not open a PR: the next step does that.",
    TASK_NOTE_MAINTENANCE_LINE,
  );
  return lines.join("\n");
}

export function buildAutoDraftPrPrompt(input: TaskImplementPromptInput & { branch?: string }): string {
  const lines = [
    `Use the create-pr skill to open a DRAFT pull request${input.repoName ? ` for the ${input.repoName} repo` : ""} from the task branch the implementation just committed${input.branch ? ` (${input.branch})` : ""}.`,
    `Plan URL (task, note path, Jira): ${taskImplementPlanUrl(input)}`,
  ];
  if (input.cwd) lines.push(`Working tree: ${input.cwd}.`);
  lines.push(
    AUTO_MODE_LINE,
    "Push the task branch and open the PR as a draft against the repo's default branch. Title and body come from the task and its note (what changed, how it was checked). Don't ask for a title or base. If there is nothing committed to open a PR from, add_question on the task note saying so and stop.",
    `DevHub task id ${input.taskId} on ${input.date}: pass that exact id/date through the skill's DevHub sync step.`,
    TASK_NOTE_MAINTENANCE_LINE,
    "Task note: once the PR exists, set_meta addLinks with the PR, set_status draft-pr and set_status_update with what the PR does.",
  );
  return lines.join("\n");
}

export function buildAutoFixPrompt(input: TaskImplementPromptInput & { round: number; maxRounds: number; findings: string[]; branch?: string }): string {
  const findings = input.findings.length ? input.findings.map((finding, index) => `${index + 1}. ${finding}`) : ["(see the open bugs in the task note)"];
  const lines = [
    `Fix round ${input.round} of ${input.maxRounds} for this DevHub task: the code review and Jev QA found these problems.`,
    ...findings,
    `Plan URL: ${taskImplementPlanUrl(input)}`,
  ];
  if (input.cwd) lines.push(`Working tree: ${input.cwd}${input.branch ? ` on branch ${input.branch}` : ""}. Stay in it.`);
  lines.push(
    AUTO_MODE_LINE,
    "Fix each finding, run the repo's checks until they pass, commit, and push to the same branch so the draft PR updates. On the task note, set_bug_status fixed for each bug you fixed, with a resolution: one sentence on what you changed and where, so the finding reads as resolved with its summary. If a finding is wrong, set_bug_status wontfix with a resolution saying why, and add_decision if it settles a choice. Don't open a new PR.",
    TASK_NOTE_MAINTENANCE_LINE,
  );
  return lines.join("\n");
}

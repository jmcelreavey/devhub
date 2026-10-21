import { TASK_NOTE_MAINTENANCE_LINE, taskImplementPlanUrl, type TaskImplementPromptInput } from "./implement-prompt";

/**
 * Prompts for Storyboard auto mode (lib/storyboard/auto-mode.ts). John's
 * "Start on auto" click is the go-ahead for the whole loop up to an open PR,
 * so these runs don't stop to ask before each git step the way the
 * interactive implement prompt does. They still stop for anything only John
 * can answer: an open question in the task note pauses auto mode at Needs you.
 */

export const AUTO_MODE_LINE =
  "DevHub auto mode: John started this task on auto, which approves implementing it, committing on a task branch and opening a pull request that is ready for review (never a draft). Do not ask before those steps. Never merge, never push to the default branch, and never touch Jira. Implementation edits, commits and pushes stay inside this task's repo checkout. You may also create or repair the repo's stored upstart and preview configuration in DevHub's private upstarts/<repo>/ directory, and update its task handoff and reusable recovery notes. Follow devhub-implement-task/preflight.md: check repos_list and the configured repos folder before cloning a missing repo from the same git organisation into that folder. Fetch once before investigation and resolve the actual remote default branch. Switch and pull --ff-only only in a clean, unused reference checkout; otherwise read the fetched default branch or use a separate worktree. Never switch this task off its implementation branch, disturb another task's checkout or service, or edit, commit or push source in reference repos. These local preparation steps are authorised without asking. If something only John can answer blocks you, add_question on the task note (pass options with the short answers you would offer, so he can pick one) and stop: DevHub pauses at Needs you and resumes when he answers. Lines in the plan or note that ask for John\'s approval before local verification (native builds, simulators, test runs, installing dependencies in the working tree) are already satisfied: go ahead without asking. How to verify is your call, not John's: choose the most automated option that stays in the working tree (an app-local Maestro or Detox flow, a test seam, a script, an emulator or simulator you can drive) and use it without asking. If a check genuinely can't be automated from here, record it in the note as a remaining manual check with the exact steps, and carry on with the rest instead of stopping to ask. Stop only for credentials, spending money, publishing, pushing to shared branches, or anything destructive outside the working tree. DevHub starts the next step itself when you finish.";

export const AUTO_REVIEW_LINE =
  "Auto review ownership: DevHub launches the selected independent reviewer after the PR step and after fixes. Skip the implementation skill\'s pre-commit review gate on Auto: do not call tasks_implement_review, launch a reviewer, write a second self-review note, or wait for a review during implementation. Run the required checks and leave exact verification evidence for that reviewer. DevHub alone advances the review/fix loop; leave the PR ready for review.";

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
    AUTO_REVIEW_LINE,
    "Reuse the task branch DevHub created; create one only if still on the default branch. Read devhub-implement-task/preflight.md before preparing the environment. Implement the plan, run focused checks while editing and the repo\'s required final checks once on the finished code, then commit with a clear message. Keep hooks enabled. Do not push and do not open a PR: the next step does that. Record the verified commit, commands, UI evidence, environment and any recovery checkpoint in the handoff.",
    TASK_NOTE_MAINTENANCE_LINE,
  );
  return lines.join("\n");
}

export function buildAutoDraftPrPrompt(input: TaskImplementPromptInput & { branch?: string }): string {
  const lines = [
    `Use the create-pr skill to open a pull request that is ready for review (not a draft)${input.repoName ? ` for the ${input.repoName} repo` : ""} from the task branch the implementation just committed${input.branch ? ` (${input.branch})` : ""}.`,
    `Plan URL (task, note path, Jira): ${taskImplementPlanUrl(input)}`,
  ];
  if (input.cwd) lines.push(`Working tree: ${input.cwd}.`);
  lines.push(
    AUTO_MODE_LINE,
    "Read the implementation handoff and reuse its checks and UI evidence for the unchanged commit. Do not rerun tests, take screenshots or start another review merely to open the PR. Check the actual checked-out branch and commit rather than relying on an older launch branch name. Keep hooks enabled. If source changes are needed, record a blocker instead of editing code in this publishing step.",
    "Push the task branch and open the PR ready for review against the repo's default branch: run `gh pr create` without `--draft`, and if the PR already exists as a draft, run `gh pr ready` on it. Title and body come from the task and its note (what changed, how it was checked). Don't ask for a title or base. If there is nothing committed to open a PR from, add_question on the task note saying so and stop.",
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
    AUTO_REVIEW_LINE,
    "Read devhub-implement-task/preflight.md and the existing review note first. Reuse the recorded environment and recovery guidance. Check each finding against the current code; fix the cause, run affected checks and required final checks once for the changed code, and refresh only the UI evidence the fix invalidates. Record any new recovery checkpoint before handing back. If the finding is resolved without a code change, preserve valid passing checks.",
    "Fix each finding, commit when files changed, and push to the same branch so the PR updates. On the task note, set_bug_status fixed for each bug you fixed, with a resolution: one sentence on what you changed and where, so the finding reads as resolved with its summary. If a finding is wrong, set_bug_status wontfix with a resolution saying why, and add_decision if it settles a choice. Don't open a new PR.",
    TASK_NOTE_MAINTENANCE_LINE,
  );
  return lines.join("\n");
}

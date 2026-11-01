import { TASK_STATUS_UPDATE_INSTRUCTION } from "../../task-note/status-update.ts";
import { OWNER_NOTES_INSTRUCTION } from "./owner-notes.ts";

export interface TaskImplementPromptInput {
  pauseAfterPlan?: boolean;
  /** Dashboard origin, e.g. http://localhost:1337. */
  origin: string;
  taskId: string;
  date: string;
  repoName?: string;
  cwd?: string;
  /** Plan only: the run starts in its own worktree, so there is no checkout path to point at. */
  isolated?: boolean;
  jiraKey?: string;
}

export function taskImplementPlanUrl(input: TaskImplementPromptInput): string {
  const repo = input.repoName ? `&repo=${encodeURIComponent(input.repoName)}` : "";
  return `${input.origin.replace(/\/$/, "")}/api/tasks/implement/plan?taskId=${encodeURIComponent(input.taskId)}&date=${encodeURIComponent(input.date)}${repo}`;
}

/** How agents keep the visual task note current (MCP task_note_update or POST /api/tasks/note/sections). */
export const TASK_NOTE_MAINTENANCE_LINE =
  OWNER_NOTES_INSTRUCTION + " " +
  TASK_STATUS_UPDATE_INSTRUCTION + " " +
  "Task note: keep it current as you work with the task_note_update MCP tool (or POST /api/tasks/note/sections with the same fields), one section op at a time, never free-form appends. Whenever your step changes, set_status (the Storyboard column) and set_status_update (the milestone context); set_summary remains available for summary-only edits; add_decision when you choose between approaches; add_media for new UI evidence owned by this stage (reuse valid captures from earlier stages); add_waypoint when a plan step is done; add_poi for risky code; add_question instead of guessing; set_meta for PR/preview links and models used. " +
  "Tidy as you go so the note reads as the current state, not a history: rewrite the summary rather than adding to it, resolve answered questions, mark bugs fixed, and remove_item or clear_section anything stale or duplicated (append_log is the history). DevHub records each agent update and shows it on the Storyboard card. Never edit my own free-form sections.";

export const TASK_QA_PLAN_INSTRUCTION =
  "For a UI task, before implementation use task_note_update op set_qa_scenario to declare up to five specific, non-sensitive text or visibility assertions for elements on the preview's initial page. Pass qaScenario: {goals:[{description,assertion:'text',selector,expected}]} (or assertion:'visible' without expected). Derive expected values from the actual task or code; never turn acceptance prose or an opinion into a pass. Do not specify URLs, actions, credentials or broad page-root checks. Only declare a scenario when the preview is known to use non-production test data without real credentials, real submissions or destructive writes. Loading a page can itself change data; a selector does not prove it is safe. Jev may receive the page URL, text and screenshots: keep private data and credentials out of the preview and scenario. If preview safety cannot be established, leave QA unset and record the exact safety gap and manual verification needed. If this run has only the scoped task_plan_update peer, pass the same qaScenario there with plan, acceptance and openQuestions. Set baselineRequired:true during planning only when before evidence is required; it can be set without a scenario. Keep an existing named QA scenario; it takes priority. If no initial-page assertion is justified, leave QA unset and record the manual verification needed.";

export const TASK_QA_IMPLEMENT_INSTRUCTION =
  "For a UI task, check the planned task QA assertions against the implemented initial page and use task_note_update op set_qa_scenario to add or correct up to five specific, non-sensitive text/visibility goals if needed. Pass qaScenario: {goals:[{description,assertion:'text',selector,expected}]} (or assertion:'visible' without expected); use facts from the task and code, not prose or model opinion. Never specify URLs, actions or credentials, and preserve an existing named QA scenario. Only declare a scenario when the preview is known to use non-production test data without real credentials, real submissions or destructive writes. Loading a page can itself change data; a selector does not prove it is safe. Jev may receive the page URL, text and screenshots: keep private data and credentials out of the preview and scenario. If preview safety cannot be established, leave QA unset and record the exact safety gap and manual verification needed. A pass covers only those assertions. Do not request a baseline after implementation has started; if it was missed, record the gap.";

export function buildTaskImplementPrompt(input: TaskImplementPromptInput): string {
  const planUrl = taskImplementPlanUrl(input);
  const repo = input.repoName ? ` in the ${input.repoName} repo` : "";
  const lines = [
    `Use the devhub-implement-task skill to implement this DevHub task end-to-end${repo}.`,
    `Plan URL (curl it first - linked notes/repos, Jira ticket, note path): ${planUrl}`,
  ];
  if (input.cwd) lines.push(`Working tree: ${input.cwd}. Stay in this checkout.`);
  if (input.jiraKey) lines.push(`Jira ticket: ${input.jiraKey}.`);
  lines.push(
    "Use the existing local repo checkout DevHub starts you in. Do not create a clone or worktree by default; switch/create the task branch in a clean checkout. If unrelated dirty work makes that unsafe, ask before using a worktree.",
    "The DevHub notes MCP is available for the task note, Jira (jira_ticket_get / jira_ticket_transition), and updating the task.",
    TASK_NOTE_MAINTENANCE_LINE,
    "Before writing any code: restate the goal in two or three lines, list the assumptions you are making, and ask anything that would change the approach. Wait for my answer only when one would change the approach; otherwise say \"no questions\" and start in the same turn.",
    "Work interactively: run commands, tests, edits and local commits directly in your own shell without proposing them for approval. Get my explicit approval before each remote step (push, PR, Jira transition, completing the task). Reuse approval I have already given in this conversation; do not ask again for the same scope. An explicit request to create the PR includes pushing the reviewed changes as needed. Jira transitions and task completion need their own explicit approval.",
    `Task workflow: ${input.origin.replace(/\/$/, "")}/storyboard?task=${encodeURIComponent(input.taskId)}&taskSection=evidence. GET /api/tasks/workflow?taskId=${input.taskId} for the current revision and evidence. POST /api/tasks/workflow with taskId, revision and action: verify to run npm run verify; review with the completed reviewer runId, verdict (pass or changes-requested), findings; propose with kind (commit-push, draft-pr, ticket-transition, task-completion), destination and exact content. Accept explicit human approval in this conversation or in DevHub. For chat approval, record the user's instruction in the task note, then POST action: decide with proposalId and approve: true. Never approve an action the user has not authorised, infer approval from silence, or require a duplicate UI confirmation. If a proposal expires, refresh the same authorised scope and record the decision again; changed scope needs fresh approval. Before executing an approved proposal, POST action: begin with proposalId to consume it; then record action: receipt with proposalId, succeeded and detail. A timeout stays outcome-unknown: check the destination before retrying. Code changes require fresh checks and review. This coordination does not restrict your local command access.`,
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
  if (input.cwd) lines.push(`Repo checkout for investigation: ${input.cwd}. Read only — no commits or branch switches in this checkout. For reference repos, follow devhub-implement-task/preflight.md: check the configured repos folder first, clone only missing repos from the same organisation there, and inspect a freshly fetched default branch without disturbing active or dirty checkouts.`);
  else if (input.isolated) lines.push("You start in an isolated worktree of the repo; investigate there. Read only — no commits or branch switches in this checkout. For reference repos, follow devhub-implement-task/preflight.md: reuse local repos, fetch their default branch once, and preserve active or dirty checkouts.");
  if (input.jiraKey) lines.push(`Jira ticket: ${input.jiraKey}.`);
  lines.push(
    TASK_NOTE_MAINTENANCE_LINE,
    TASK_QA_PLAN_INSTRUCTION,
    ...(input.pauseAfterPlan ? ["Pause after planning is on. When the plan is ready, write Current state: Plan ready, waiting for approval, and Next step: Approve plan or Revise. Stop after planning; never approve your own plan or start implementation."] : []),
    "Task note write access is pre-approved: if task_note_update has no operation for Plan, Acceptance or Verification, read the whole note with notes_read and save it back with notes_write, changing only Plan, Acceptance and Verification and preserving every other section exactly (including Your notes). Do not ask permission for this. Write the result into the task note: ## Plan (the change, the files, the commands that prove it worked) and ## Acceptance. Under ## Verification name the required checks and UI evidence owner. Add the standalone line Baseline capture: required only when before/after evidence was requested or a visual reproduction needs it; otherwise omit it. Put anything only I can answer under ## Open questions as unchecked boxes.",
    `When nothing is left open, mark the task ready: POST ${input.origin.replace(/\/$/, "")}/api/tasks/stage with {"taskId":"${input.taskId}","date":"${input.date}","stage":"ready"} (409 lists what's still missing). Otherwise leave it as a draft and tell me the questions.`,
  );
  return lines.join("\n");
}

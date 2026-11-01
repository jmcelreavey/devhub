import { z } from "zod";
import { TASK_NOTE_STATUSES } from "../task-note/meta.ts";
import { defineAction } from "./define.ts";

const dashboardTaskId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/, "Invalid task ID");
const dashboardIdempotencyKey = z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/, "Invalid idempotency key");

export const storyboardPlanDecisionInput = z.object({
  action: z.literal("plan-decision"),
  taskId: dashboardTaskId,
  idempotencyKey: dashboardIdempotencyKey,
  planRunId: z.string().max(80).min(1),
  decision: z.enum(["approve", "revise"]),
  guidance: z.string().trim().min(1).max(4000).optional(),
});
export interface StoryboardPlanDecisionContext {
  decide: (input: z.output<typeof storyboardPlanDecisionInput>) => Promise<StoryboardResetResult>;
}
export const storyboardPlanDecision = defineAction<typeof storyboardPlanDecisionInput, StoryboardPlanDecisionContext, StoryboardResetResult>({
  input: storyboardPlanDecisionInput,
  http: { method: "POST", path: "/api/storyboard/orchestrate", discriminator: "body action=plan-decision" },
  mcp: { reason: "Plan approval is an interactive dashboard decision." },
  handler: (input, context) => context.decide(input),
});

export const storyboardAskBackInput = z.object({
  action: z.literal("ask-back"),
  taskId: dashboardTaskId,
  text: z.string().trim().min(1).max(4000),
  idempotencyKey: dashboardIdempotencyKey,
});
export interface StoryboardAskBackContext {
  ask: (input: z.output<typeof storyboardAskBackInput>) => Promise<StoryboardResetResult>;
}
export const storyboardAskBack = defineAction<typeof storyboardAskBackInput, StoryboardAskBackContext, StoryboardResetResult>({
  input: storyboardAskBackInput,
  http: { method: "POST", path: "/api/storyboard/orchestrate", discriminator: "body action=ask-back" },
  mcp: { reason: "Asking back is an interactive dashboard response to a pending question." },
  handler: (input, context) => context.ask(input),
});

export const storyboardSummariesInput = z.object({});
export interface StoryboardSummariesContext {
  read: () => Promise<StoryboardResetResult>;
}
export const storyboardSummaries = defineAction<typeof storyboardSummariesInput, StoryboardSummariesContext, StoryboardResetResult>({
  input: storyboardSummariesInput,
  http: { method: "GET", path: "/api/storyboard/orchestrate", discriminator: "query taskId is empty or absent" },
  mcp: { reason: "The reconciled summary index is used by the dashboard board and task rows." },
  handler: (_input, context) => context.read(),
});

export const storyboardMoveInput = z.object({
  taskId: dashboardTaskId,
  status: z.enum(TASK_NOTE_STATUSES),
  stopActive: z.boolean().optional(),
});
export interface StoryboardMoveContext {
  move: (input: z.output<typeof storyboardMoveInput>) => Promise<StoryboardResetResult>;
}
export const storyboardMove = defineAction<typeof storyboardMoveInput, StoryboardMoveContext, StoryboardResetResult>({
  input: storyboardMoveInput,
  http: { method: "POST", path: "/api/storyboard/move" },
  mcp: { reason: "Manual board moves and their active-work confirmation belong to the dashboard workflow." },
  handler: (input, context) => context.move(input),
});

export const storyboardStopWorkInput = z.object({ taskId: dashboardTaskId });
export interface StoryboardStopWorkContext {
  stop: (taskId: string) => Promise<StoryboardResetResult>;
}
export const storyboardStopWork = defineAction<typeof storyboardStopWorkInput, StoryboardStopWorkContext, StoryboardResetResult>({
  input: storyboardStopWorkInput,
  http: { method: "POST", path: "/api/storyboard/stop-work" },
  mcp: { reason: "Pausing live work is an interactive dashboard control, not an additional agent action." },
  handler: ({ taskId }, context) => context.stop(taskId),
});

export const storyboardReviewNotesInput = z.object({});
export interface StoryboardReviewNotesContext {
  read: () => unknown;
}
export const storyboardReviewNotes = defineAction<typeof storyboardReviewNotesInput, StoryboardReviewNotesContext, unknown>({
  input: storyboardReviewNotesInput,
  http: { method: "GET", path: "/api/storyboard/pr-review-notes" },
  mcp: { reason: "This compact review-note index is a dashboard board presentation detail." },
  handler: (_input, context) => context.read(),
});

export const storyboardBoardInput = z.object({
  status: z.enum(["todo", "planning", "in-progress", "needs-you", "blocked", "draft-pr", "ready-for-review", "done"]).optional().describe("Only this column"),
  tag: z.string().optional().describe("Only cards carrying this tag (no #)"),
  repo: z.string().optional().describe("Only cards for this repo (its short name, e.g. example-app), the board's repo filter"),
  jira: z.string().optional().describe('Only cards with this Jira key, or "none" for cards with no Jira'),
  parentJira: z.string().optional().describe("Only cards under this parent (epic) key, e.g. ABC-123: its child tickets and cards linked to it directly. A child whose parent DevHub hasn't fetched from Jira yet is not matched."),
  includeOlderDone: z.boolean().optional(),
}).meta({ additionalProperties: false });

export interface StoryboardBoardContext {
  read: (input: z.output<typeof storyboardBoardInput>) => Promise<StoryboardResetResult> | StoryboardResetResult;
}

export const storyboardBoard = defineAction<typeof storyboardBoardInput, StoryboardBoardContext, StoryboardResetResult>({
  input: storyboardBoardInput,
  http: { method: "GET", path: "/api/storyboard" },
  mcp: {
    name: "storyboard_board", toolset: "storyboard",
    description: "The Storyboard as data: task notes grouped by note status (todo, planning, in-progress, needs-you, blocked, draft-pr, ready-for-review, done). Each card is a task with its day (taskDate), note path, tags, repo, Jira keys and parent (epic), PR, open question/bug counts, Jev bugs and whether it is stuck. A To do card nothing drives yet has nextAction storyboard_start_auto (the card's Start on auto button). Done shows the last 14 days unless includeOlderDone.",
  },
  handler: (input, context) => context.read(input),
});

export const storyboardPositionInput = z.object({
  taskId: z.string(),
  before: z.string().optional().describe("Put it just above this card"),
  after: z.string().optional().describe("Put it just below this card"),
  to: z.enum(["top", "bottom"]).optional(),
  rank: z.string().optional().describe("Explicit fractional rank (lowercase base-36, not ending in 0)"),
}).meta({ additionalProperties: false });

export interface StoryboardPositionContext {
  requireSingleChoice: boolean;
  set: (input: z.output<typeof storyboardPositionInput>) => Promise<StoryboardResetResult> | StoryboardResetResult;
}

export const storyboardPosition = defineAction<typeof storyboardPositionInput, StoryboardPositionContext, StoryboardResetResult & { isError?: boolean }>({
  input: storyboardPositionInput,
  http: { method: "POST", path: "/api/storyboard/position" },
  mcp: {
    name: "storyboard_position", toolset: "storyboard",
    description: "Move a card up or down within its Storyboard column (the board's drag or Alt+Up/Down). Give before or after (another card's taskId in the same column), to: top|bottom, or an explicit rank. Writes the card's rank in its note's task-meta; ranked cards sort before unranked ones, so placing a card below never-ranked cards ranks those above it once. Use storyboard_board to see the order.",
  },
  handler: async (input, context) => {
    if (context.requireSingleChoice && [input.before, input.after, input.to, input.rank].filter((value) => value !== undefined).length !== 1) {
      return { status: 400, body: "Give exactly one of before, after, to or rank.", isError: true };
    }
    return context.set(input);
  },
});

export const storyboardCardActionInput = z.object({
  action: z.enum(["answer", "retry", "auto-retry", "clear", "open-pr"]),
  taskId: z.string().optional(),
  runId: z.string().optional().describe("Run to clear"),
  url: z.string().optional().describe("PR URL for open-pr (from storyboard_attention)"),
}).meta({ additionalProperties: false });

export interface StoryboardCardActionContext {
  retry: (taskId: string, date: string) => Promise<unknown>;
  autoRetry: (taskId: string) => Promise<unknown>;
  clear: (taskId: string, runId: string) => Promise<void>;
}

export type StoryboardCardActionResult =
  | { type: "text"; text: string; isError?: boolean }
  | { type: "json"; value: unknown };

export const storyboardCardAction = defineAction<typeof storyboardCardActionInput, StoryboardCardActionContext, StoryboardCardActionResult>({
  input: storyboardCardActionInput,
  http: { reason: "This MCP command coordinates existing board, task-run and note actions rather than a separate HTTP endpoint." },
  mcp: {
    name: "storyboard_card_action", toolset: "storyboard",
    description: "Run a stuck card's action, the same as its button on the board. retry: restart the task agent (follow-up preferred). auto-retry: a task on auto stopped at Needs you after a failed step or the fix-round cap carries on (same as storyboard_auto_retry). clear: mark an idle run abandoned (needs runId). open-pr: returns the PR URL. answer: points you at task_note_update resolve_question, which is how a question gets answered.",
  },
  handler: async ({ action, taskId, runId, url }, context) => {
    if (action === "answer") return { type: "text", text: `Answer from the note, not the board: task_note_update { ${taskId ? `taskId: "${taskId}", ` : ""}op: "read" } lists the open questions with ids, then task_note_update { op: "resolve_question", id, answer }. The card stays highlighted while its status is needs-you, so follow with set_status when the task can move on.` };
    if (action === "open-pr") return url ? { type: "text", text: `Open: ${url}` } : { type: "text", text: "url is required for open-pr", isError: true };
    if (!taskId) return { type: "text", text: "taskId is required", isError: true };
    if (action === "auto-retry") return { type: "json", value: await context.autoRetry(taskId) };
    if (action === "retry") {
      const result = await context.retry(taskId, new Date().toLocaleDateString("en-CA"));
      return { type: "json", value: { retried: taskId, result } };
    }
    if (!runId) return { type: "text", text: "runId is required for clear", isError: true };
    await context.clear(taskId, runId);
    return { type: "text", text: `Cleared idle run ${runId} on ${taskId}.` };
  },
});

export const storyboardJevReviewInput = z.object({ taskId: z.string().optional() }).meta({ additionalProperties: false });
export interface StoryboardJevReviewContext {
  read: () => Promise<{ cards: Array<{ taskId: string; title: string; status: string; notePath: string | null; jev: object | null }> }>;
}
export const storyboardJevReview = defineAction<typeof storyboardJevReviewInput, StoryboardJevReviewContext, unknown[]>({
  input: storyboardJevReviewInput,
  http: { reason: "The MCP review is a filtered projection of the existing board, not a separate HTTP endpoint." },
  mcp: {
    name: "storyboard_jev_review", toolset: "storyboard",
    description: "Jev QA results on the board: per task, the latest run's status, bug count, before/after video links and receipt link. Filter by taskId.",
  },
  handler: async ({ taskId }, context) => (await context.read()).cards
    .filter((card) => card.jev && (!taskId || card.taskId === taskId))
    .map((card) => ({ taskId: card.taskId, title: card.title, column: card.status, notePath: card.notePath, ...card.jev })),
});

export const storyboardJevRunInput = z.object({
  scenarioId: z.string(),
  taskId: z.string().optional(),
  baseline: z.boolean().optional(),
}).meta({ additionalProperties: false });
export interface StoryboardJevRunContext {
  run: (input: z.output<typeof storyboardJevRunInput>) => Promise<StoryboardResetResult>;
}
export const storyboardJevRun = defineAction<typeof storyboardJevRunInput, StoryboardJevRunContext, StoryboardResetResult>({
  input: storyboardJevRunInput,
  http: { method: "POST", path: "/api/qa" },
  mcp: {
    name: "storyboard_jev_run", toolset: "storyboard",
    description: "Trigger a Jev QA run (records a demo video and lists bugs) for a scenario, optionally linked to a task. baseline=true records the 'before' video.",
  },
  handler: (input, context) => context.run(input),
});

const tierName = z.enum(["cheap", "mid", "heavy"]);
const tierStep = z.enum(["plan", "implement", "verify", "draft-pr", "review"]);
const tierPatches = z.partialRecord(tierName, z.object({ provider: z.string().optional(), model: z.string().optional(), effort: z.string().optional() }));
const stepPatches = z.partialRecord(tierStep, tierName);

export const storyboardModelTiersGetInput = z.object({ taskId: z.string().optional() }).meta({ additionalProperties: false });
export interface StoryboardModelTiersGetContext {
  readDefault: () => Promise<unknown> | unknown;
  readTask: (taskId: string) => Promise<unknown> | unknown;
}
export type StoryboardModelTiersGetResult = { kind: "settings"; settings: unknown } | { kind: "missing"; taskId: string };
export const storyboardModelTiersGet = defineAction<typeof storyboardModelTiersGetInput, StoryboardModelTiersGetContext, StoryboardModelTiersGetResult>({
  input: storyboardModelTiersGetInput,
  http: { method: "GET", path: "/api/storyboard/model-tiers" },
  mcp: { name: "storyboard_model_tiers_get", toolset: "storyboard", description: "Saved cheap/mid/heavy model tiers (agent + model each) and which tier each step uses. With taskId: the tiers that task was started with." },
  handler: async ({ taskId }, context) => {
    if (!taskId) return { kind: "settings", settings: await context.readDefault() };
    const settings = await context.readTask(taskId);
    return settings ? { kind: "settings", settings } : { kind: "missing", taskId };
  },
});

export const storyboardModelTiersSetInput = z.object({ tiers: tierPatches.optional(), steps: stepPatches.optional() }).meta({ additionalProperties: false });
export interface StoryboardModelTiersSetContext {
  set: (input: z.output<typeof storyboardModelTiersSetInput>) => Promise<unknown> | unknown;
}
export const storyboardModelTiersSet = defineAction<typeof storyboardModelTiersSetInput, StoryboardModelTiersSetContext, unknown>({
  input: storyboardModelTiersSetInput,
  http: { method: "PUT", path: "/api/storyboard/model-tiers" },
  mcp: {
    name: "storyboard_model_tiers_set", toolset: "storyboard",
    description: "Save model-tier defaults used by future auto runs. Partial: pass only what changes. tiers.<cheap|mid|heavy> = {provider, model} (empty = agent default); steps.<plan|implement|verify|draft-pr|review> = tier.",
  },
  handler: (input, context) => context.set(input),
});

export const storyboardStartAutoInput = z.object({
  taskId: z.string(),
  taskDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("The task's day (YYYY-MM-DD), as tasks_list reports it."),
  steps: stepPatches.optional(),
  tiers: tierPatches.optional(),
  pauseAfterPlan: z.boolean().optional().describe("Pause at Plan ready for approval before implementation. Default false."),
  createPr: z.boolean().optional().describe("Open a PR before verification. Default false; verification runs without publishing."),
  saveAsDefaults: z.boolean().optional(),
}).meta({ additionalProperties: false });
export interface StoryboardStartAutoContext {
  start: (input: z.output<typeof storyboardStartAutoInput>) => Promise<StoryboardResetResult>;
}
export const storyboardStartAuto = defineAction<typeof storyboardStartAutoInput, StoryboardStartAutoContext, StoryboardResetResult>({
  input: storyboardStartAutoInput,
  http: { method: "POST", path: "/api/storyboard/orchestrate", discriminator: "body action=start" },
  mcp: {
    name: "storyboard_start_auto", toolset: "storyboard",
    description: "Start a task on auto (Storyboard plans it, then each step runs on its model tier). Omit steps/tiers to use the saved defaults, like the one-click Start on auto. Pass steps.<plan|implement|verify|draft-pr|review> = tier (and tiers.<cheap|mid|heavy> = {provider, model}) to override for this task; saveAsDefaults also saves them. Spawns a plan agent run.",
  },
  handler: (input, context) => context.start(input),
});

export const storyboardSetModeInput = z.object({ taskId: z.string(), mode: z.enum(["auto", "manual"]) }).meta({ additionalProperties: false });
export interface StoryboardSetModeContext {
  set: (input: z.output<typeof storyboardSetModeInput>) => Promise<StoryboardResetResult>;
}
export const storyboardSetMode = defineAction<typeof storyboardSetModeInput, StoryboardSetModeContext, StoryboardResetResult>({
  input: storyboardSetModeInput,
  http: { method: "POST", path: "/api/storyboard/orchestrate", discriminator: "body action=mode" },
  mcp: {
    name: "storyboard_set_mode", toolset: "storyboard",
    description: "The card's Auto/Manual switch for a task started on auto. manual: auto mode stops advancing and cancels the run it started (you take over). auto: it picks up where it stopped (refused for a task ticked done or abandoned). Spawns an agent run when resuming.",
  },
  handler: (input, context) => context.set(input),
});

export const storyboardAnswerRepoInput = z.object({
  taskId: z.string(),
  taskDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("The task's day (YYYY-MM-DD), as tasks_list reports it."),
  cwd: z.string().min(1).describe("Absolute path of the repo checkout."),
}).meta({ additionalProperties: false });
export interface StoryboardAnswerRepoContext {
  answer: (input: z.output<typeof storyboardAnswerRepoInput>) => Promise<StoryboardResetResult>;
}
export const storyboardAnswerRepo = defineAction<typeof storyboardAnswerRepoInput, StoryboardAnswerRepoContext, StoryboardResetResult>({
  input: storyboardAnswerRepoInput,
  http: { method: "POST", path: "/api/storyboard/orchestrate", discriminator: "body action=answer-repo" },
  mcp: {
    name: "storyboard_answer_repo", toolset: "storyboard",
    description: "Answer a task's \"which repo?\" question when Start on auto couldn't tell where to run (the card's repo picker): cwd is the repo's local checkout path. Auto mode then plans the task there. Spawns a plan agent run.",
  },
  handler: (input, context) => context.answer(input),
});

export const storyboardAutoStatusInput = z.object({ taskId: z.string() }).meta({ additionalProperties: false });
export interface StoryboardAutoStatusContext {
  read: (taskId: string) => Promise<StoryboardResetResult> | StoryboardResetResult;
}
export const storyboardAutoStatus = defineAction<typeof storyboardAutoStatusInput, StoryboardAutoStatusContext, StoryboardResetResult>({
  input: storyboardAutoStatusInput,
  http: { method: "GET", path: "/api/storyboard/orchestrate", discriminator: "query taskId is nonempty" },
  mcp: {
    name: "storyboard_auto_status", toolset: "storyboard",
    description: "Auto mode for a task: its phase (plan, baseline = before video, implement, draft-pr, verify = review + Jev, fix, ready), fix round of max, what it's waiting on (questions, failure, cap, queued), each run it dispatched with tier and why, whether it counts as a UI change (and the card override), and the Jev preview (url, started dev server, or none).",
  },
  handler: ({ taskId }, context) => context.read(taskId),
});

export const storyboardSetUiInput = z.object({ taskId: z.string(), ui: z.enum(["yes", "no", "auto"]) }).meta({ additionalProperties: false });
export interface StoryboardSetUiContext {
  set: (input: { taskId: string; ui: boolean | null }) => Promise<StoryboardResetResult>;
}
export const storyboardSetUi = defineAction<typeof storyboardSetUiInput, StoryboardSetUiContext, StoryboardResetResult & { taskId: string }>({
  input: storyboardSetUiInput,
  http: { method: "POST", path: "/api/storyboard/orchestrate", discriminator: "body action=ui" },
  mcp: {
    name: "storyboard_set_ui", toolset: "storyboard",
    description: "The card's UI-change toggle for a task on auto. DevHub detects a UI change from the changed files (tsx/css/screens) and the plan's touched paths; Jev records before/after videos only for UI changes. ui: yes or no overrides detection; auto clears the override.",
  },
  handler: async ({ taskId, ui }, context) => ({ taskId, ...await context.set({ taskId, ui: ui === "auto" ? null : ui === "yes" }) }),
});

export const storyboardPreviewInput = z.object({ repo: z.string().optional() }).meta({ additionalProperties: false });
export interface StoryboardPreviewContext {
  read: (repo?: string) => Promise<unknown> | unknown;
}
export const storyboardPreview = defineAction<typeof storyboardPreviewInput, StoryboardPreviewContext, unknown>({
  input: storyboardPreviewInput,
  http: { method: "GET", path: "/api/storyboard/preview" },
  mcp: {
    name: "storyboard_preview_status", toolset: "storyboard",
    description: "Check a repo's automatic QA preview opt-in and running previews. For a static build in the task checkout, use upstarts/<repo>/preview.json with {\"autoStart\":true,\"kind\":\"static\",\"directory\":\"dist\",\"path\":\"/\"}. For a trusted dynamic app, use {\"autoStart\":true,\"kind\":\"dev\",\"trustCommand\":true,\"command\":\"npm run dev -- --hostname 127.0.0.1 --port {port}\"}. The command runs local project code with inherited environment and network access; bind it to 127.0.0.1, use {port}, and do not set a fixed port. Dynamic ownership checks require Unix and lsof.",
  },
  handler: ({ repo }, context) => context.read(repo),
});

export const storyboardAttentionInput = z.object({}).meta({ additionalProperties: false });
export interface StoryboardAttentionContext {
  read: () => Promise<StoryboardResetResult> | StoryboardResetResult;
}
export const storyboardAttention = defineAction<typeof storyboardAttentionInput, StoryboardAttentionContext, StoryboardResetResult>({
  input: storyboardAttentionInput,
  http: { method: "GET", path: "/api/storyboard/attention" },
  mcp: {
    name: "storyboard_attention", toolset: "storyboard",
    description: "List Storyboard cards that need attention — waiting on the user (needs-you or open questions), a failed run or open blocker bug, an agent running >2h, or a PR awaiting review — each with its one-click action: open (answer in the note: use task_note_update resolve_question), open-pr (URL returned), retry or clear (use storyboard_card_action).",
  },
  handler: (_input, context) => context.read(),
});

export const storyboardAutoRetryInput = z.object({ taskId: z.string() }).meta({ additionalProperties: false });
export interface StoryboardAutoRetryContext {
  retry: (taskId: string) => Promise<StoryboardResetResult>;
}
export const storyboardAutoRetry = defineAction<typeof storyboardAutoRetryInput, StoryboardAutoRetryContext, StoryboardResetResult & { taskId: string }>({
  input: storyboardAutoRetryInput,
  http: { method: "POST", path: "/api/storyboard/orchestrate", discriminator: "body action=retry" },
  mcp: {
    name: "storyboard_auto_retry", toolset: "storyboard",
    description: "Carry on a task that auto mode stopped at Needs you: after a failed or paused step it re-runs the step on the next tier up; at the fix-round cap it grants one more round; after questions it continues once they are resolved in the note. A task started on auto before auto mode advanced by itself is upgraded and continues from its finished plan. Spawns agent runs.",
  },
  handler: async ({ taskId }, context) => ({ taskId, ...await context.retry(taskId) }),
});

export const storyboardResetInput = z.object({
  taskId: z.string(),
  discardWork: z.boolean().default(false),
  confirm: z.boolean().default(false).describe("Must be true to reset; confirm discarded local work with the user first."),
}).meta({ additionalProperties: false });

export interface StoryboardResetContext {
  reset: (input: { taskId: string; discardWork: boolean }) => Promise<{ status: number; body: unknown }>;
}

export interface StoryboardResetResult {
  status: number;
  body: unknown;
}

export const storyboardReset = defineAction<typeof storyboardResetInput, StoryboardResetContext, StoryboardResetResult>({
  input: storyboardResetInput,
  http: { method: "POST", path: "/api/storyboard/orchestrate", discriminator: "body action=reset" },
  mcp: {
    name: "storyboard_reset",
    toolset: "storyboard",
    description: "Reset an open task to To do: stop its runs and clear auto mode, keeping the task, note and run history. discardWork also removes its local agent worktrees and devhub/agent/* branches; pushed branches and PRs stay. Requires confirm:true.",
  },
  handler: async ({ taskId, discardWork, confirm }, context) => {
    if (!confirm) return {
      status: 200,
      body: {
        taskId, dryRun: true, discardWork,
        note: discardWork ? "Would reset to To do and discard local agent worktrees and branches. Pass confirm:true." : "Would stop the runs and reset to To do, keeping local work. Pass confirm:true.",
      },
    };
    return context.reset({ taskId, discardWork });
  },
});

export const storyboardRerunInput = z.object({
  taskId: z.string(),
  step: z.enum(["qa", "review"]),
  idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/).optional().describe("Reuse this key when retrying the same request after a timeout."),
}).meta({ additionalProperties: false });

export interface StoryboardRerunContext {
  rerun: (input: z.output<typeof storyboardRerunInput>) => Promise<StoryboardResetResult>;
}

export const storyboardRerun = defineAction<typeof storyboardRerunInput, StoryboardRerunContext, StoryboardResetResult>({
  input: storyboardRerunInput,
  http: { method: "POST", path: "/api/storyboard/orchestrate", discriminator: "body action=rerun" },
  mcp: {
    name: "storyboard_rerun", toolset: "storyboard",
    description: "Re-run QA or review for a task on auto, using its pinned checkout and a new attempt. The task must be open with no active step; resolve open questions first. Spawns an agent or QA run.",
  },
  handler: (input, context) => context.rerun(input),
});

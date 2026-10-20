import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Context } from "../context.ts";
import { withDashboardErrors } from "../dashboard-client.ts";

const TIERS = ["cheap", "mid", "heavy"] as const;
const STEPS = ["plan", "implement", "verify", "draft-pr", "review"] as const;
type Tier = (typeof TIERS)[number];
interface TierSettings {
  tiers: Record<Tier, { provider: string; model: string; effort?: string }>;
  steps: Record<(typeof STEPS)[number], Tier>;
}
const COLUMNS = ["todo", "planning", "in-progress", "needs-you", "blocked", "draft-pr", "ready-for-review", "done"] as const;
interface CardAction { kind: string; label: string; url?: string; href?: string; taskId?: string; runId?: string }
interface AttentionCard { taskId: string; title: string; status: string; noteHref: string | null; runId?: string; reason: string; label: string; action: CardAction }
interface JevInfo { runId: string; title: string; status: string; capturedAt: string; bugCount: number; goalsPassed: number; goalsTotal: number; receiptHref: string; beforeVideo: string | null; afterVideo: string | null }
interface BoardCard {
  taskId: string; title: string; status: string; taskDone?: boolean; date: string; notePath: string | null; noteHref: string | null; tags: string[]; repo?: string; rank?: string; jira?: string[]; parentJira?: string; prUrl?: string; updatedAt: string;
  counts: { openQuestions: number; openBugs: number; blockerBugs: number; decisions: number };
  jev: JevInfo | null; attention: { reason: string; label: string; action: CardAction } | null;
  tiers: Array<{ step: string; tier: string; active: boolean }> | null; run: { status: string } | null;
  auto?: { phase: string; label: string; round: number; maxRounds: number; waiting?: { kind: string; reason: string }; ui?: { value: boolean; detected: boolean; reason: string; override?: boolean }; noPreview?: string; qaSkipped?: string };
  steps?: Array<{ runId: string; role: string; status: string; label?: string; tier?: string; tierReason?: string }>;
}
interface Board { columns: Array<{ status: string; label: string; count: number }>; cards: BoardCard[]; hiddenDone: number; errors: string[] }

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const json = (value: unknown) => text(JSON.stringify(value, null, 2));

/** Storyboard: the board of task notes by status, stuck-card actions, model tiers and Jev review. Mirrors the GUI; needs the dashboard running. */
export function registerStoryboardTools(server: McpServer, ctx: Context): void {
  const { dashboard } = ctx;

  server.registerTool(
    "storyboard_board",
    {
      description:
        "The Storyboard as data: task notes grouped by note status (todo, planning, in-progress, needs-you, blocked, draft-pr, ready-for-review, done). " +
        "Each card is a task with its day (taskDate), note path, tags, repo, Jira keys and parent (epic), PR, open question/bug counts, Jev bugs and whether it is stuck. A To do card nothing drives yet has nextAction storyboard_start_auto (the card's Start on auto button). Done shows the last 14 days unless includeOlderDone.",
      inputSchema: {
        status: z.enum(COLUMNS).optional().describe("Only this column"),
        tag: z.string().optional().describe("Only cards carrying this tag (no #)"),
        repo: z.string().optional().describe("Only cards for this repo (its short name, e.g. vowbreak), the board's repo filter"),
        jira: z.string().optional().describe('Only cards with this Jira key, or "none" for cards with no Jira'),
        parentJira: z.string().optional().describe("Only cards under this parent (epic) key, e.g. PTF-4891: its child tickets and cards linked to it directly. A child whose parent DevHub hasn't fetched from Jira yet is not matched."),
        includeOlderDone: z.boolean().optional(),
      },
    },
    async ({ status, tag, repo, jira, parentJira, includeOlderDone }) =>
      withDashboardErrors(async () => {
        // The dashboard applies repo/jira/parentJira with the same code as the board's URL filters.
        const query: Record<string, string> = {
          ...(includeOlderDone ? { done: "all" } : {}),
          ...(repo?.trim() ? { repo: repo.trim() } : {}),
          ...(jira?.trim() ? { jira: jira.trim() } : {}),
          ...(parentJira?.trim() ? { parentJira: parentJira.trim() } : {}),
        };
        const board = await dashboard.get<Board>("/api/storyboard", Object.keys(query).length ? query : undefined);
        const wanted = tag?.replace(/^#/, "").toLowerCase();
        const cards = board.cards.filter((card) => (!status || card.status === status) && (!wanted || card.tags.includes(wanted)));
        return json({
          columns: board.columns.filter((column) => !status || column.status === status),
          cards: cards.map((card) => ({
            taskId: card.taskId, taskDate: card.date, title: card.title, status: card.status, notePath: card.notePath, tags: card.tags, repo: card.repo, prUrl: card.prUrl,
            ...(card.rank ? { rank: card.rank } : {}), ...(card.jira?.length ? { jira: card.jira } : {}), ...(card.parentJira ? { parentJira: card.parentJira } : {}),
            openQuestions: card.counts.openQuestions, openBugs: card.counts.openBugs, decisions: card.counts.decisions,
            jevBugs: card.jev?.bugCount, stuck: card.attention?.label, updatedAt: card.updatedAt,
            ...(card.auto ? { auto: card.auto } : {}),
            // The GUI's one primary action on a To do card: storyboard_start_auto with this taskId and taskDate.
            ...(card.status === "todo" && !card.taskDone && !card.auto && !card.attention ? { nextAction: "storyboard_start_auto" } : {}),
          })),
          hiddenDone: board.hiddenDone,
          ...(board.errors.length ? { errors: board.errors } : {}),
        });
      }),
  );

  server.registerTool(
    "storyboard_attention",
    {
      description:
        "List Storyboard cards that need attention — waiting on John (needs-you or open questions), a failed run or open blocker bug, an agent running >2h, or a PR awaiting review — " +
        "each with its one-click action: open (answer in the note: use task_note_update resolve_question), open-pr (URL returned), retry or clear (use storyboard_card_action).",
      inputSchema: {},
    },
    async () =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{ cards: AttentionCard[] }>("/api/storyboard/attention");
        if (!data.cards.length) return text("Nothing stuck on the board.");
        return json(data.cards);
      }),
  );

  server.registerTool(
    "storyboard_card_action",
    {
      description:
        "Run a stuck card's action, the same as its button on the board. retry: restart the task agent (follow-up preferred). auto-retry: a task on auto stopped at Needs you after a failed step or the fix-round cap carries on (same as storyboard_auto_retry). " +
        "clear: mark an idle run abandoned (needs runId). open-pr: returns the PR URL. answer: points you at task_note_update resolve_question, which is how a question gets answered.",
      inputSchema: {
        action: z.enum(["answer", "retry", "auto-retry", "clear", "open-pr"]),
        taskId: z.string().optional(),
        runId: z.string().optional().describe("Run to clear"),
        url: z.string().optional().describe("PR URL for open-pr (from storyboard_attention)"),
      },
    },
    async ({ action, taskId, runId, url }) =>
      withDashboardErrors(async () => {
        if (action === "answer") {
          return text(`Answer from the note, not the board: task_note_update { ${taskId ? `taskId: "${taskId}", ` : ""}op: "read" } lists the open questions with ids, then task_note_update { op: "resolve_question", id, answer }. The card stays highlighted while its status is needs-you, so follow with set_status when the task can move on.`);
        }
        if (action === "open-pr") return url ? text(`Open: ${url}`) : { ...text("url is required for open-pr"), isError: true };
        if (!taskId) return { ...text("taskId is required"), isError: true };
        if (action === "auto-retry") return json(await autoRetry(taskId));
        if (action === "retry") {
          const date = new Date().toLocaleDateString("en-CA");
          const result = await dashboard.post("/api/tasks/agent-runs/resume", { taskId, date });
          return json({ retried: taskId, result });
        }
        if (!runId) return { ...text("runId is required for clear"), isError: true };
        await dashboard.post("/api/tasks/agent-runs", { taskId, runId, status: "abandoned" });
        return text(`Cleared idle run ${runId} on ${taskId}.`);
      }),
  );

  server.registerTool(
    "storyboard_model_tiers_get",
    {
      description: "Saved cheap/mid/heavy model tiers (agent + model each) and which tier each step uses. With taskId: the tiers that task was started with.",
      inputSchema: { taskId: z.string().optional() },
    },
    async ({ taskId }) =>
      withDashboardErrors(async () => {
        if (taskId) {
          const data = await dashboard.get<{ summary?: { tiers?: TierSettings } }>("/api/storyboard/orchestrate", { taskId });
          return data.summary?.tiers ? json(data.summary.tiers) : text(`Task ${taskId} has no recorded tiers (not started on auto, or started before tiers existed).`);
        }
        return json((await dashboard.get<{ settings: TierSettings }>("/api/storyboard/model-tiers")).settings);
      }),
  );

  server.registerTool(
    "storyboard_model_tiers_set",
    {
      description:
        "Save model-tier defaults used by future auto runs. Partial: pass only what changes. tiers.<cheap|mid|heavy> = {provider, model} (empty = agent default); steps.<plan|implement|verify|draft-pr|review> = tier.",
      inputSchema: {
        tiers: z.record(z.enum(TIERS), z.object({ provider: z.string().optional(), model: z.string().optional(), effort: z.string().optional() })).optional(),
        steps: z.record(z.enum(STEPS), z.enum(TIERS)).optional(),
      },
    },
    async ({ tiers, steps }) =>
      withDashboardErrors(async () => {
        const current = (await dashboard.get<{ settings: TierSettings }>("/api/storyboard/model-tiers")).settings;
        const next = mergeTierSettings(current, tiers, steps);
        return json((await dashboard.put<{ settings: TierSettings }>("/api/storyboard/model-tiers", next)).settings);
      }),
  );

  server.registerTool(
    "storyboard_start_auto",
    {
      description:
        "Start a task on auto (Storyboard plans it, then each step runs on its model tier). Omit steps/tiers to use the saved defaults, like the one-click Start on auto. Pass steps.<plan|implement|verify|draft-pr|review> = tier (and tiers.<cheap|mid|heavy> = {provider, model}) to override for this task; saveAsDefaults also saves them. Spawns a plan agent run.",
      inputSchema: {
        taskId: z.string(),
        taskDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("The task's day (YYYY-MM-DD), as tasks_list reports it."),
        steps: z.record(z.enum(STEPS), z.enum(TIERS)).optional(),
        tiers: z.record(z.enum(TIERS), z.object({ provider: z.string().optional(), model: z.string().optional(), effort: z.string().optional() })).optional(),
        pauseAfterPlan: z.boolean().optional().describe("Pause at Plan ready for approval before implementation. Default false."),
        saveAsDefaults: z.boolean().optional(),
      },
    },
    async ({ taskId, taskDate, steps, tiers, saveAsDefaults, pauseAfterPlan }) =>
      withDashboardErrors(async () => {
        const current = (await dashboard.get<{ settings: TierSettings }>("/api/storyboard/model-tiers")).settings;
        const chosen = mergeTierSettings(current, tiers, steps);
        if (saveAsDefaults && (steps || tiers)) await dashboard.put("/api/storyboard/model-tiers", chosen);
        const result = await dashboard.post<{ summary?: { status?: string; lastError?: string }; runId?: string | null }>("/api/storyboard/orchestrate", {
          action: "start", taskId, taskDate, idempotencyKey: randomUUID().replaceAll("-", ""), tiers: chosen, ...(pauseAfterPlan !== undefined ? { pauseAfterPlan } : {}),
        });
        return json({ ...result, tiers: chosen.steps, savedAsDefaults: Boolean(saveAsDefaults && (steps || tiers)) });
      }),
  );

  async function autoRetry(taskId: string) {
    const result = await dashboard.post<{ summary?: { status?: string; lastError?: string; auto?: unknown } }>("/api/storyboard/orchestrate", {
      action: "retry", taskId, idempotencyKey: `retry-${randomUUID().replaceAll("-", "")}`,
    });
    return { taskId, status: result.summary?.status, auto: result.summary?.auto, ...(result.summary?.lastError ? { note: result.summary.lastError } : {}) };
  }

  server.registerTool(
    "storyboard_auto_status",
    {
      description:
        "Auto mode for a task: its phase (plan, baseline = before video, implement, draft-pr, verify = review + Jev, fix, ready), fix round of max, what it's waiting on (questions, failure, cap, queued), " +
        "each run it dispatched with tier and why, whether it counts as a UI change (and the card override), and the Jev preview (url, started dev server, or none).",
      inputSchema: { taskId: z.string() },
    },
    async ({ taskId }) =>
      withDashboardErrors(async () => {
        const data = await dashboard.get<{ summary?: Record<string, unknown> }>("/api/storyboard/orchestrate", { taskId });
        return json(data.summary ?? {});
      }),
  );

  server.registerTool(
    "storyboard_auto_retry",
    {
      description:
        "Carry on a task that auto mode stopped at Needs you: after a failed or paused step it re-runs the step on the next tier up; at the fix-round cap it grants one more round; after questions it continues once they are resolved in the note. " +
        "A task started on auto before auto mode advanced by itself is upgraded and continues from its finished plan. Spawns agent runs.",
      inputSchema: { taskId: z.string() },
    },
    async ({ taskId }) => withDashboardErrors(async () => json(await autoRetry(taskId))),
  );

  server.registerTool(
    "storyboard_reset",
    {
      description:
        "Reset an open task to To do: stop its runs and clear auto mode, keeping the task, note and run history. " +
        "discardWork also removes its local agent worktrees and devhub/agent/* branches; pushed branches and PRs stay. Requires confirm:true.",
      inputSchema: {
        taskId: z.string(),
        discardWork: z.boolean().default(false),
        confirm: z.boolean().default(false).describe("Must be true to reset; confirm discarded local work with the user first."),
      },
    },
    async ({ taskId, discardWork, confirm }) =>
      withDashboardErrors(async () => {
        if (!confirm) return json({ taskId, dryRun: true, discardWork, note: discardWork ? "Would reset to To do and discard local agent worktrees and branches. Pass confirm:true." : "Would stop the runs and reset to To do, keeping local work. Pass confirm:true." });
        return json(await dashboard.post("/api/storyboard/orchestrate", { action: "reset", taskId, discardWork }));
      }),
  );

  server.registerTool(
    "storyboard_rerun",
    {
      description: "Re-run QA or review for a task on auto, using its pinned checkout and a new attempt. The task must be open with no active step; resolve open questions first. Spawns an agent or QA run.",
      inputSchema: {
        taskId: z.string(),
        step: z.enum(["qa", "review"]),
        idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/).optional().describe("Reuse this key when retrying the same request after a timeout."),
      },
    },
    async ({ taskId, step, idempotencyKey }) =>
      withDashboardErrors(async () => json(await dashboard.post("/api/storyboard/orchestrate", {
        action: "rerun", taskId, step, idempotencyKey: idempotencyKey ?? `rerun-${randomUUID().replaceAll("-", "")}`,
      }))),
  );

  server.registerTool(
    "storyboard_preview_status",
    {
      description:
        "Whether auto mode can start a repo's preview for Jev when a task has no preview URL (opt-in via upstarts/<repo>/preview.json: " +
        '{"autoStart": true, "kind": "dev" | "expo-web", "command"?: "... {port}", "port"?, "path"?: "/", "readyTimeoutSec"?}), and the previews DevHub is running. ' +
        "Without it Jev is skipped and the card shows No preview.",
      inputSchema: { repo: z.string().optional() },
    },
    async ({ repo }) =>
      withDashboardErrors(async () => json(await dashboard.get("/api/storyboard/preview", repo ? { repo } : undefined))),
  );

  server.registerTool(
    "storyboard_set_ui",
    {
      description:
        "The card's UI-change toggle for a task on auto. DevHub detects a UI change from the changed files (tsx/css/screens) and the plan's touched paths; Jev records before/after videos only for UI changes. " +
        "ui: yes or no overrides detection; auto clears the override.",
      inputSchema: { taskId: z.string(), ui: z.enum(["yes", "no", "auto"]) },
    },
    async ({ taskId, ui }) =>
      withDashboardErrors(async () => {
        const result = await dashboard.post<{ summary?: { auto?: { ui?: unknown } } }>("/api/storyboard/orchestrate", { action: "ui", taskId, ui: ui === "auto" ? null : ui === "yes" });
        return json({ taskId, ui: result.summary?.auto?.ui ?? null });
      }),
  );

  server.registerTool(
    "storyboard_position",
    {
      description:
        "Move a card up or down within its Storyboard column (the board's drag or Alt+Up/Down). Give before or after (another card's taskId in the same column), to: top|bottom, or an explicit rank. " +
        "Writes the card's rank in its note's task-meta; ranked cards sort before unranked ones, so placing a card below never-ranked cards ranks those above it once. Use storyboard_board to see the order.",
      inputSchema: {
        taskId: z.string(),
        before: z.string().optional().describe("Put it just above this card"),
        after: z.string().optional().describe("Put it just below this card"),
        to: z.enum(["top", "bottom"]).optional(),
        rank: z.string().optional().describe("Explicit fractional rank (lowercase base-36, not ending in 0)"),
      },
    },
    async ({ taskId, before, after, to, rank }) =>
      withDashboardErrors(async () => {
        if ([before, after, to, rank].filter((value) => value !== undefined).length !== 1) return { ...text("Give exactly one of before, after, to or rank."), isError: true };
        const result = await dashboard.post<{ taskId: string; writes: Array<{ taskId: string; rank: string }> }>("/api/storyboard/position", {
          taskId, ...(before ? { before } : {}), ...(after ? { after } : {}), ...(to ? { to } : {}), ...(rank ? { rank } : {}),
        });
        return json(result.writes.length ? result : { taskId, writes: [], note: "Already there." });
      }),
  );

  server.registerTool(
    "storyboard_set_mode",
    {
      description:
        "The card's Auto/Manual switch for a task started on auto. manual: auto mode stops advancing and cancels the run it started (you take over). " +
        "auto: it picks up where it stopped (refused for a task ticked done or abandoned). Spawns an agent run when resuming.",
      inputSchema: { taskId: z.string(), mode: z.enum(["auto", "manual"]) },
    },
    async ({ taskId, mode }) =>
      withDashboardErrors(async () => {
        const result = await dashboard.post<{ summary?: { status?: string; lastError?: string; auto?: unknown }; runId?: string | null; cancelled?: unknown; dispatchError?: string | null }>("/api/storyboard/orchestrate", {
          action: "mode", taskId, mode, idempotencyKey: `mode-${randomUUID().replaceAll("-", "")}`,
        });
        return json({
          taskId, mode, status: result.summary?.status, auto: result.summary?.auto,
          ...(result.runId ? { runId: result.runId } : {}), ...(result.cancelled ? { cancelled: result.cancelled } : {}),
          ...(result.dispatchError ? { error: result.dispatchError } : result.summary?.lastError ? { note: result.summary.lastError } : {}),
        });
      }),
  );

  server.registerTool(
    "storyboard_answer_repo",
    {
      description:
        "Answer a task's \"which repo?\" question when Start on auto couldn't tell where to run (the card's repo picker): cwd is the repo's local checkout path. " +
        "Auto mode then plans the task there. Spawns a plan agent run.",
      inputSchema: {
        taskId: z.string(),
        taskDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("The task's day (YYYY-MM-DD), as tasks_list reports it."),
        cwd: z.string().min(1).describe("Absolute path of the repo checkout."),
      },
    },
    async ({ taskId, taskDate, cwd }) =>
      withDashboardErrors(async () => {
        const result = await dashboard.post<{ summary?: { status?: string; lastError?: string }; runId?: string | null; dispatchError?: string | null }>("/api/storyboard/orchestrate", {
          action: "answer-repo", taskId, taskDate, cwd, idempotencyKey: `repo-${randomUUID().replaceAll("-", "")}`,
        });
        return json({ taskId, status: result.summary?.status, ...(result.runId ? { runId: result.runId } : {}), ...(result.dispatchError ? { error: result.dispatchError } : result.summary?.lastError ? { note: result.summary.lastError } : {}) });
      }),
  );

  server.registerTool(
    "storyboard_jev_review",
    {
      description: "Jev QA results on the board: per task, the latest run's status, bug count, before/after video links and receipt link. Filter by taskId.",
      inputSchema: { taskId: z.string().optional() },
    },
    async ({ taskId }) =>
      withDashboardErrors(async () => {
        const board = await dashboard.get<Board>("/api/storyboard", { done: "all" });
        const reviews = board.cards.filter((card) => card.jev && (!taskId || card.taskId === taskId)).map((card) => ({
          taskId: card.taskId, title: card.title, column: card.status, notePath: card.notePath, ...card.jev,
        }));
        return reviews.length ? json(reviews) : text("No Jev QA runs on the board yet.");
      }),
  );

  server.registerTool(
    "storyboard_jev_run",
    {
      description: "Trigger a Jev QA run (records a demo video and lists bugs) for a scenario, optionally linked to a task. baseline=true records the 'before' video.",
      inputSchema: { scenarioId: z.string(), taskId: z.string().optional(), baseline: z.boolean().optional() },
    },
    async ({ scenarioId, taskId, baseline }) =>
      withDashboardErrors(async () => {
        const result = await dashboard.post("/api/qa", { action: "run", scenarioId, requestId: randomUUID(), ...(taskId ? { taskId } : {}), ...(baseline ? { baseline } : {}) });
        return json(result);
      }),
  );
}

export function mergeTierSettings(
  current: TierSettings,
  tiers?: Partial<Record<Tier, { provider?: string; model?: string; effort?: string }>>,
  steps?: Partial<TierSettings["steps"]>,
): TierSettings {
  const next: TierSettings = { tiers: { ...current.tiers }, steps: { ...current.steps, ...(steps ?? {}) } };
  for (const tier of TIERS) {
    const patch = tiers?.[tier];
    if (patch) next.tiers[tier] = { ...current.tiers[tier], ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  }
  return next;
}

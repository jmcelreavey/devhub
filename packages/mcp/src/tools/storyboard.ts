import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "node:crypto";
import { storyboardAnswerRepo, storyboardAttention, storyboardAutoRetry, storyboardAutoStatus, storyboardBoard, storyboardCardAction, storyboardJevReview, storyboardJevRun, storyboardModelTiersGet, storyboardModelTiersSet, storyboardPosition, storyboardPreview, storyboardRerun, storyboardReset, storyboardSetMode, storyboardSetUi, storyboardStartAuto } from "../../../../packages/shared/actions/storyboard.ts";
import { registerAction } from "../actions/register.ts";
import type { Context } from "../context.ts";
import { withDashboardErrors, type DashboardToolResult } from "../dashboard-client.ts";

const TIERS = ["cheap", "mid", "heavy"] as const;
type Tier = (typeof TIERS)[number];
type Step = "plan" | "implement" | "verify" | "draft-pr" | "review";
interface TierSettings {
  tiers: Record<Tier, { provider: string; model: string; effort?: string }>;
  steps: Record<Step, Tier>;
}
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

  registerAction(
    server, storyboardBoard,
    { read: async ({ status, tag, repo, jira, parentJira, includeOlderDone }) => {
        const query: Record<string, string> = {
          ...(includeOlderDone ? { done: "all" } : {}),
          ...(repo?.trim() ? { repo: repo.trim() } : {}),
          ...(jira?.trim() ? { jira: jira.trim() } : {}),
          ...(parentJira?.trim() ? { parentJira: parentJira.trim() } : {}),
        };
        const board = await dashboard.get<Board>("/api/storyboard", Object.keys(query).length ? query : undefined);
        const wanted = tag?.replace(/^#/, "").toLowerCase();
        const cards = board.cards.filter((card) => (!status || card.status === status) && (!wanted || card.tags.includes(wanted)));
        return { status: 200, body: {
          columns: board.columns.filter((column) => !status || column.status === status),
          cards: cards.map((card) => ({
            taskId: card.taskId, taskDate: card.date, title: card.title, status: card.status, notePath: card.notePath, tags: card.tags, repo: card.repo, prUrl: card.prUrl,
            ...(card.rank ? { rank: card.rank } : {}), ...(card.jira?.length ? { jira: card.jira } : {}), ...(card.parentJira ? { parentJira: card.parentJira } : {}),
            openQuestions: card.counts.openQuestions, openBugs: card.counts.openBugs, decisions: card.counts.decisions,
            jevBugs: card.jev?.bugCount, stuck: card.attention?.label, updatedAt: card.updatedAt,
            ...(card.auto ? { auto: card.auto } : {}),
            ...(card.status === "todo" && !card.taskDone && !card.auto && !card.attention ? { nextAction: "storyboard_start_auto" } : {}),
          })),
          hiddenDone: board.hiddenDone,
          ...(board.errors.length ? { errors: board.errors } : {}),
        } };
      } },
    ({ body }) => json(body),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, storyboardAttention,
    { read: async () => ({ status: 200, body: await dashboard.get<{ cards: AttentionCard[] }>("/api/storyboard/attention") }) },
    ({ body }) => {
      const { cards } = body as { cards: AttentionCard[] };
      return cards.length ? json(cards) : text("Nothing stuck on the board.");
    },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, storyboardCardAction,
    {
      retry: (taskId, date) => dashboard.post("/api/tasks/agent-runs/resume", { taskId, date }),
      autoRetry: (taskId) => autoRetry(taskId),
      clear: async (taskId, runId) => { await dashboard.post("/api/tasks/agent-runs", { taskId, runId, status: "abandoned" }); },
    },
    (result) => result.type === "json" ? json(result.value) : { ...text(result.text), ...(result.isError ? { isError: true } : {}) },
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, storyboardModelTiersGet,
    {
      readDefault: async () => (await dashboard.get<{ settings: TierSettings }>("/api/storyboard/model-tiers")).settings,
      readTask: async (taskId) => (await dashboard.get<{ summary?: { tiers?: TierSettings } }>("/api/storyboard/orchestrate", { taskId })).summary?.tiers,
    },
    (result) => result.kind === "settings" ? json(result.settings) : text(`Task ${result.taskId} has no recorded tiers (not started on auto, or started before tiers existed).`),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, storyboardModelTiersSet,
    { set: async ({ tiers, steps }) => {
        const current = (await dashboard.get<{ settings: TierSettings }>("/api/storyboard/model-tiers")).settings;
        const next = mergeTierSettings(current, tiers, steps);
        return (await dashboard.put<{ settings: TierSettings }>("/api/storyboard/model-tiers", next)).settings;
      } },
    (settings) => json(settings),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, storyboardStartAuto,
    { start: async ({ taskId, taskDate, steps, tiers, saveAsDefaults, pauseAfterPlan, createPr }) => {
        const current = (await dashboard.get<{ settings: TierSettings }>("/api/storyboard/model-tiers")).settings;
        const chosen = mergeTierSettings(current, tiers, steps);
        if (saveAsDefaults && (steps || tiers)) await dashboard.put("/api/storyboard/model-tiers", chosen);
        const result = await dashboard.post<{ summary?: { status?: string; lastError?: string }; runId?: string | null }>("/api/storyboard/orchestrate", {
          action: "start", taskId, taskDate, idempotencyKey: randomUUID().replaceAll("-", ""), tiers: chosen, ...(pauseAfterPlan !== undefined ? { pauseAfterPlan } : {}), ...(createPr !== undefined ? { createPr } : {}),
        });
        return { status: 200, body: { ...result, tiers: chosen.steps, savedAsDefaults: Boolean(saveAsDefaults && (steps || tiers)) } };
      } },
    ({ body }) => json(body),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  const retryContext = { retry: async (taskId: string) => ({ status: 200, body: await dashboard.post<{ summary?: { status?: string; lastError?: string; auto?: unknown } }>("/api/storyboard/orchestrate", {
    action: "retry", taskId, idempotencyKey: `retry-${randomUUID().replaceAll("-", "")}`,
  }) }) };
  function retrySummary({ taskId, body }: { taskId: string; body: unknown }) {
    const result = body as { summary?: { status?: string; lastError?: string; auto?: unknown } };
    return { taskId, status: result.summary?.status, auto: result.summary?.auto, ...(result.summary?.lastError ? { note: result.summary.lastError } : {}) };
  }
  async function autoRetry(taskId: string) {
    return retrySummary(await storyboardAutoRetry.handler({ taskId }, retryContext));
  }

  registerAction(
    server, storyboardAutoStatus,
    { read: async (taskId) => ({ status: 200, body: await dashboard.get<{ summary?: Record<string, unknown> }>("/api/storyboard/orchestrate", { taskId }) }) },
    ({ body }) => json((body as { summary?: Record<string, unknown> }).summary ?? {}),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, storyboardAutoRetry,
    retryContext,
    (result) => json(retrySummary(result)),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, storyboardReset,
    { reset: async ({ taskId, discardWork }) => ({
      status: 200,
      body: await dashboard.post("/api/storyboard/orchestrate", { action: "reset", taskId, discardWork }),
    }) },
    ({ body }) => json(body),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, storyboardRerun,
    { rerun: async ({ taskId, step, idempotencyKey }) => ({
      status: 200,
      body: await dashboard.post("/api/storyboard/orchestrate", {
        action: "rerun", taskId, step, idempotencyKey: idempotencyKey ?? `rerun-${randomUUID().replaceAll("-", "")}`,
      }),
    }) },
    ({ body }) => json(body),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, storyboardPreview,
    { read: (repo) => dashboard.get("/api/storyboard/preview", repo ? { repo } : undefined) },
    (result) => json(result),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, storyboardSetUi,
    { set: async ({ taskId, ui }) => ({ status: 200, body: await dashboard.post<{ summary?: { auto?: { ui?: unknown } } }>("/api/storyboard/orchestrate", { action: "ui", taskId, ui }) }) },
    ({ taskId, body }) => json({ taskId, ui: (body as { summary?: { auto?: { ui?: unknown } } }).summary?.auto?.ui ?? null }),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, storyboardPosition,
    { requireSingleChoice: true, set: async ({ taskId, before, after, to, rank }) => {
        const result = await dashboard.post<{ taskId: string; writes: Array<{ taskId: string; rank: string }> }>("/api/storyboard/position", {
          taskId, ...(before ? { before } : {}), ...(after ? { after } : {}), ...(to ? { to } : {}), ...(rank ? { rank } : {}),
        });
        return { status: 200, body: result.writes.length ? result : { taskId, writes: [], note: "Already there." } };
      } },
    (result) => result.isError ? { ...text(String(result.body)), isError: true } : json(result.body),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, storyboardSetMode,
    { set: async ({ taskId, mode }) => {
        const result = await dashboard.post<{ summary?: { status?: string; lastError?: string; auto?: unknown }; runId?: string | null; cancelled?: unknown; dispatchError?: string | null }>("/api/storyboard/orchestrate", {
          action: "mode", taskId, mode, idempotencyKey: `mode-${randomUUID().replaceAll("-", "")}`,
        });
        return { status: 200, body: {
          taskId, mode, status: result.summary?.status, auto: result.summary?.auto,
          ...(result.runId ? { runId: result.runId } : {}), ...(result.cancelled ? { cancelled: result.cancelled } : {}),
          ...(result.dispatchError ? { error: result.dispatchError } : result.summary?.lastError ? { note: result.summary.lastError } : {}),
        } };
      } },
    ({ body }) => json(body),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, storyboardAnswerRepo,
    { answer: async ({ taskId, taskDate, cwd }) => {
        const result = await dashboard.post<{ summary?: { status?: string; lastError?: string }; runId?: string | null; dispatchError?: string | null }>("/api/storyboard/orchestrate", {
          action: "answer-repo", taskId, taskDate, cwd, idempotencyKey: `repo-${randomUUID().replaceAll("-", "")}`,
        });
        return { status: 200, body: { taskId, status: result.summary?.status, ...(result.runId ? { runId: result.runId } : {}), ...(result.dispatchError ? { error: result.dispatchError } : result.summary?.lastError ? { note: result.summary.lastError } : {}) } };
      } },
    ({ body }) => json(body),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, storyboardJevReview,
    { read: () => dashboard.get<Board>("/api/storyboard", { done: "all" }) },
    (reviews) => reviews.length ? json(reviews) : text("No Jev QA runs on the board yet."),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
  );

  registerAction(
    server, storyboardJevRun,
    { run: async ({ scenarioId, taskId, baseline }) => ({ status: 200, body: await dashboard.post("/api/qa", { action: "run", scenarioId, requestId: randomUUID(), ...(taskId ? { taskId } : {}), ...(baseline ? { baseline } : {}) }) }) },
    ({ body }) => json(body),
    (operation) => withDashboardErrors(async () => await operation() as DashboardToolResult),
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

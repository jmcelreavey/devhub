import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Context } from "../context.ts";
import { DashboardClient, type DashboardToolResult } from "../dashboard-client.ts";
import { mergeTierSettings, registerStoryboardTools } from "./storyboard.ts";

type Handler = (input: unknown) => Promise<DashboardToolResult>;
function setup() {
  const dashboard = new DashboardClient("http://localhost:1337");
  const tools = new Map<string, Handler>();
  const server = {
    registerTool(name: string, config: { inputSchema?: z.ZodRawShape }, handler: Handler) {
      const schema = z.object(config.inputSchema ?? {});
      tools.set(name, async (input) => handler(schema.parse(input)));
    },
  };
  registerStoryboardTools(server as unknown as McpServer, { dashboard } as Context);
  return { dashboard, tools };
}

const settings = {
  tiers: { cheap: { provider: "", model: "" }, mid: { provider: "", model: "" }, heavy: { provider: "", model: "" } },
  steps: { plan: "mid", implement: "mid", verify: "cheap", "draft-pr": "cheap", review: "heavy" },
} as const;

describe("storyboard MCP tools", () => {
  it("registers every tool", () => {
    expect([...setup().tools.keys()].sort()).toEqual(["storyboard_answer_repo", "storyboard_attention", "storyboard_auto_retry", "storyboard_auto_status", "storyboard_board", "storyboard_card_action", "storyboard_jev_review", "storyboard_jev_run", "storyboard_model_tiers_get", "storyboard_model_tiers_set", "storyboard_position", "storyboard_preview_status", "storyboard_rerun", "storyboard_reset", "storyboard_set_mode", "storyboard_set_ui", "storyboard_start_auto"]);
  });

  it("lists stuck cards from the attention endpoint", async () => {
    const { dashboard, tools } = setup();
    const get = vi.spyOn(dashboard, "get").mockResolvedValue({ cards: [{ taskId: "t", title: "Run", status: "in-progress", noteHref: null, reason: "idle", label: "Agent idle", action: { kind: "clear", label: "Clear", taskId: "t", runId: "r" } }] });
    const result = await tools.get("storyboard_attention")!({});
    expect(get).toHaveBeenCalledWith("/api/storyboard/attention");
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("Agent idle") });
    get.mockResolvedValue({ cards: [] });
    expect((await tools.get("storyboard_attention")!({})).content[0]).toMatchObject({ text: "Nothing stuck on the board." });
  });

  it("board lists cards by status and tag, hiding nothing the filters keep", async () => {
    const { dashboard, tools } = setup();
    const card = (taskId: string, status: string, tags: string[], extra = {}) => ({
      taskId, title: `Task ${taskId}`, status, date: "2026-10-10", notePath: `task-notes/2026-10-10-${taskId}`, noteHref: `/notes/task-notes/2026-10-10-${taskId}`, tags, updatedAt: "2026-10-17T10:00:00Z",
      counts: { openQuestions: 1, openBugs: 0, blockerBugs: 0, decisions: 2 }, jev: null, attention: null, tiers: null, run: null, ...extra,
    });
    const get = vi.spyOn(dashboard, "get").mockResolvedValue({
      columns: [{ status: "todo", label: "To do", count: 1 }, { status: "needs-you", label: "Needs you", count: 1 }],
      cards: [card("a", "todo", ["auth"]), card("b", "needs-you", ["notes"], { attention: { reason: "awaiting", label: "Waiting on you", action: { kind: "open", label: "Answer" } } })],
      hiddenDone: 3, errors: [],
    });
    const read = async (input: object) => JSON.parse(((await tools.get("storyboard_board")!(input)).content[0] as { text: string }).text);
    expect((await read({})).cards.map((item: { taskId: string }) => item.taskId)).toEqual(["a", "b"]);
    expect(get).toHaveBeenCalledWith("/api/storyboard", undefined);
    const stuck = await read({ status: "needs-you" });
    expect(stuck.cards).toHaveLength(1);
    expect(stuck.cards[0]).toMatchObject({ taskId: "b", stuck: "Waiting on you", openQuestions: 1, decisions: 2 });
    expect(stuck.columns).toEqual([{ status: "needs-you", label: "Needs you", count: 1 }]);
    expect((await read({ tag: "#Auth" })).cards.map((item: { taskId: string }) => item.taskId)).toEqual(["a"]);
    // The To do card carries what storyboard_start_auto needs, flagged as its next action; the stuck one does not.
    const all = (await read({})).cards;
    expect(all[0]).toMatchObject({ taskId: "a", taskDate: "2026-10-10", nextAction: "storyboard_start_auto" });
    expect(all[1].nextAction).toBeUndefined();
    await read({ includeOlderDone: true });
    expect(get).toHaveBeenLastCalledWith("/api/storyboard", { done: "all" });
    // Repo and Jira filters are applied by the dashboard, the same code as the board's URL filters.
    await read({ repo: "vowbreak", jira: "none", parentJira: " PTF-4891 " });
    expect(get).toHaveBeenLastCalledWith("/api/storyboard", { repo: "vowbreak", jira: "none", parentJira: "PTF-4891" });
  });

  it("board passes Jira keys and the parent through on each card", async () => {
    const { dashboard, tools } = setup();
    vi.spyOn(dashboard, "get").mockResolvedValue({
      columns: [], hiddenDone: 0, errors: [],
      cards: [{ taskId: "a", title: "A", status: "todo", date: "2026-10-10", notePath: null, noteHref: null, tags: [], updatedAt: "2026-10-17T10:00:00Z", jira: ["PTF-5000"], parentJira: "PTF-4891", counts: { openQuestions: 0, openBugs: 0, blockerBugs: 0, decisions: 0 }, jev: null, attention: null, tiers: null, run: null }],
    });
    const result = JSON.parse(((await tools.get("storyboard_board")!({})).content[0] as { text: string }).text);
    expect(result.cards[0]).toMatchObject({ jira: ["PTF-5000"], parentJira: "PTF-4891" });
  });

  it("position moves a card within its column through the dashboard", async () => {
    const { dashboard, tools } = setup();
    const post = vi.spyOn(dashboard, "post").mockResolvedValue({ taskId: "a", writes: [{ taskId: "a", rank: "i" }] });
    const result = await tools.get("storyboard_position")!({ taskId: "a", before: "b" });
    expect(post).toHaveBeenCalledWith("/api/storyboard/position", { taskId: "a", before: "b" });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('"rank": "i"') });
    expect((await tools.get("storyboard_position")!({ taskId: "a" })).isError).toBe(true);
    expect((await tools.get("storyboard_position")!({ taskId: "a", to: "top", rank: "i" })).isError).toBe(true);
    post.mockResolvedValue({ taskId: "a", writes: [] });
    expect((await tools.get("storyboard_position")!({ taskId: "a", to: "top" })).content[0]).toMatchObject({ text: expect.stringContaining("Already there.") });
  });

  it("answer points at task_note_update instead of answering from the board", async () => {
    const { tools } = setup();
    const result = await tools.get("storyboard_card_action")!({ action: "answer", taskId: "t" });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining("resolve_question") });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('taskId: "t"') });
  });

  it("clear abandons the run and retry resumes the task", async () => {
    const { dashboard, tools } = setup();
    const post = vi.spyOn(dashboard, "post").mockResolvedValue({});
    await tools.get("storyboard_card_action")!({ action: "clear", taskId: "t", runId: "r" });
    expect(post).toHaveBeenCalledWith("/api/tasks/agent-runs", { taskId: "t", runId: "r", status: "abandoned" });
    await tools.get("storyboard_card_action")!({ action: "retry", taskId: "t" });
    expect(post).toHaveBeenLastCalledWith("/api/tasks/agent-runs/resume", { taskId: "t", date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect((await tools.get("storyboard_card_action")!({ action: "clear", taskId: "t" })).isError).toBe(true);
  });

  it("tiers_set merges a partial change onto the saved defaults", async () => {
    const { dashboard, tools } = setup();
    vi.spyOn(dashboard, "get").mockResolvedValue({ settings });
    const put = vi.spyOn(dashboard, "put").mockImplementation(async (_p, body) => ({ settings: body }));
    await tools.get("storyboard_model_tiers_set")!({ tiers: { cheap: { model: "haiku", effort: "low" } }, steps: { review: "mid" } });
    expect(put.mock.calls[0][1]).toMatchObject({ tiers: { cheap: { provider: "", model: "haiku", effort: "low" } }, steps: { review: "mid", plan: "mid" } });
    expect(mergeTierSettings(settings as never).steps.verify).toBe("cheap");
  });

  it("jev_review returns the Jev info of the cards that have it", async () => {
    const { dashboard, tools } = setup();
    const get = vi.spyOn(dashboard, "get").mockResolvedValue({ cards: [
      { taskId: "t", title: "Notes UX", status: "ready-for-review", notePath: "task-notes/2026-10-10-t", jev: { runId: "r", status: "failed", bugCount: 2, beforeVideo: "/b.webm", afterVideo: "/a.webm", receiptHref: "/qa?run=r&task=t" } },
      { taskId: "u", title: "No Jev", status: "todo", notePath: null, jev: null },
    ], columns: [], hiddenDone: 0, errors: [] });
    const text = (await tools.get("storyboard_jev_review")!({})).content[0] as { text: string };
    expect(get).toHaveBeenCalledWith("/api/storyboard", { done: "all" });
    const reviews = JSON.parse(text.text);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ taskId: "t", bugCount: 2, beforeVideo: "/b.webm", afterVideo: "/a.webm", receiptHref: "/qa?run=r&task=t" });
    expect((await tools.get("storyboard_jev_review")!({ taskId: "u" })).content[0]).toMatchObject({ text: "No Jev QA runs on the board yet." });
  });

  it("jev_run posts a QA run", async () => {
    const { dashboard, tools } = setup();
    const post = vi.spyOn(dashboard, "post").mockResolvedValue({ run: { id: "r" } });
    await tools.get("storyboard_jev_run")!({ scenarioId: "smoke", taskId: "t", baseline: true });
    expect(post).toHaveBeenCalledWith("/api/qa", expect.objectContaining({ action: "run", scenarioId: "smoke", taskId: "t", baseline: true }));
  });
  it("starts a task on auto on the saved tiers, or on per-task overrides it can save", async () => {
    const { dashboard, tools } = setup();
    vi.spyOn(dashboard, "get").mockResolvedValue({ settings });
    const put = vi.spyOn(dashboard, "put").mockResolvedValue({ settings });
    const post = vi.spyOn(dashboard, "post").mockResolvedValue({ runId: "run-1", summary: { status: "running" } });
    await tools.get("storyboard_start_auto")!({ taskId: "t1", taskDate: "2026-10-17" });
    expect(post).toHaveBeenLastCalledWith("/api/storyboard/orchestrate", expect.objectContaining({ action: "start", taskId: "t1", taskDate: "2026-10-17", tiers: settings }));
    expect(put).not.toHaveBeenCalled();
    const result = await tools.get("storyboard_start_auto")!({ taskId: "t1", taskDate: "2026-10-17", steps: { implement: "heavy" }, tiers: { heavy: { effort: "max" } }, saveAsDefaults: true });
    const sent = (post.mock.lastCall as unknown[])[1] as { tiers: typeof settings };
    expect(sent.tiers.steps).toMatchObject({ implement: "heavy", plan: "mid" });
    expect(sent.tiers.tiers.heavy).toMatchObject({ ...settings.tiers.heavy, effort: "max" });
    expect(put).toHaveBeenCalledWith("/api/storyboard/model-tiers", sent.tiers);
    expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ runId: "run-1", savedAsDefaults: true });
  });

  it("retries auto mode and reports its state", async () => {
    const { dashboard, tools } = setup();
    const post = vi.spyOn(dashboard, "post").mockResolvedValue({ summary: { status: "running", auto: { phase: "fix", round: 3, maxRounds: 3 } } });
    const result = await tools.get("storyboard_auto_retry")!({ taskId: "t1" });
    expect(post).toHaveBeenCalledWith("/api/storyboard/orchestrate", expect.objectContaining({ action: "retry", taskId: "t1", idempotencyKey: expect.stringMatching(/^retry-[a-f0-9]{32}$/) }));
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('"phase": "fix"') });
    await tools.get("storyboard_card_action")!({ action: "auto-retry", taskId: "t1" });
    expect(post).toHaveBeenCalledTimes(2);
    const get = vi.spyOn(dashboard, "get").mockResolvedValue({ summary: { auto: { phase: "verify", waiting: { kind: "queued", reason: "Queued" } } } });
    const status = await tools.get("storyboard_auto_status")!({ taskId: "t1" });
    expect(get).toHaveBeenCalledWith("/api/storyboard/orchestrate", { taskId: "t1" });
    expect(status.content[0]).toMatchObject({ text: expect.stringContaining("queued") });
  });

  it("sets and clears the UI-change override", async () => {
    const { dashboard, tools } = setup();
    const post = vi.spyOn(dashboard, "post").mockResolvedValue({ summary: { auto: { ui: { detected: false, reason: "none", override: true } } } });
    await tools.get("storyboard_set_ui")!({ taskId: "t1", ui: "yes" });
    expect(post).toHaveBeenLastCalledWith("/api/storyboard/orchestrate", { action: "ui", taskId: "t1", ui: true });
    await tools.get("storyboard_set_ui")!({ taskId: "t1", ui: "auto" });
    expect(post).toHaveBeenLastCalledWith("/api/storyboard/orchestrate", { action: "ui", taskId: "t1", ui: null });
  });

  it("flips the Auto/Manual switch and answers the repo question, like the card", async () => {
    const { dashboard, tools } = setup();
    const post = vi.spyOn(dashboard, "post").mockResolvedValue({ summary: { status: "paused-manual" }, runId: null, cancelled: { runId: "r1" } });
    const manual = await tools.get("storyboard_set_mode")!({ taskId: "t1", mode: "manual" });
    expect(post).toHaveBeenLastCalledWith("/api/storyboard/orchestrate", { action: "mode", taskId: "t1", mode: "manual", idempotencyKey: expect.stringMatching(/^mode-[a-f0-9]{32}$/) });
    expect(JSON.parse((manual.content[0] as { text: string }).text)).toMatchObject({ taskId: "t1", mode: "manual", status: "paused-manual", cancelled: { runId: "r1" } });
    post.mockResolvedValue({ summary: { status: "paused-manual" }, runId: null, dispatchError: "That task is closed. Reopen it before resuming auto." });
    const refused = await tools.get("storyboard_set_mode")!({ taskId: "t1", mode: "auto" });
    expect(JSON.parse((refused.content[0] as { text: string }).text)).toMatchObject({ error: expect.stringContaining("closed") });
    post.mockResolvedValue({ summary: { status: "running" }, runId: "run-plan" });
    const answered = await tools.get("storyboard_answer_repo")!({ taskId: "t1", taskDate: "2026-10-17", cwd: "/repo/app" });
    expect(post).toHaveBeenLastCalledWith("/api/storyboard/orchestrate", { action: "answer-repo", taskId: "t1", taskDate: "2026-10-17", cwd: "/repo/app", idempotencyKey: expect.stringMatching(/^repo-[a-f0-9]{32}$/) });
    expect(JSON.parse((answered.content[0] as { text: string }).text)).toMatchObject({ status: "running", runId: "run-plan" });
  });

  it("previews reset without confirmation and forwards the selected cleanup only when confirmed", async () => {
    const { dashboard, tools } = setup();
    const post = vi.spyOn(dashboard, "post").mockResolvedValue({ reset: { stoppedRuns: 1, keptCheckouts: ["/worktree"] } });
    const preview = await tools.get("storyboard_reset")!({ taskId: "t1", discardWork: true });
    expect(JSON.parse((preview.content[0] as { text: string }).text)).toMatchObject({ dryRun: true, discardWork: true });
    expect(post).not.toHaveBeenCalled();
    await tools.get("storyboard_reset")!({ taskId: "t1", confirm: true });
    expect(post).toHaveBeenLastCalledWith("/api/storyboard/orchestrate", { action: "reset", taskId: "t1", discardWork: false });
    await tools.get("storyboard_reset")!({ taskId: "t1", discardWork: true, confirm: true });
    expect(post).toHaveBeenLastCalledWith("/api/storyboard/orchestrate", { action: "reset", taskId: "t1", discardWork: true });
  });

  it.each(["qa", "review"])("starts a new %s attempt and preserves a supplied retry key", async (step) => {
    const { dashboard, tools } = setup();
    const post = vi.spyOn(dashboard, "post").mockResolvedValue({ summary: { status: "running" } });
    await tools.get("storyboard_rerun")!({ taskId: "t1", step });
    expect(post).toHaveBeenLastCalledWith("/api/storyboard/orchestrate", { action: "rerun", taskId: "t1", step, idempotencyKey: expect.stringMatching(/^rerun-[a-f0-9]{32}$/) });
    await tools.get("storyboard_rerun")!({ taskId: "t1", step, idempotencyKey: "rerun-retry-key" });
    expect(post).toHaveBeenLastCalledWith("/api/storyboard/orchestrate", { action: "rerun", taskId: "t1", step, idempotencyKey: "rerun-retry-key" });
    await expect(tools.get("storyboard_rerun")!({ taskId: "t1", step: "implement" })).rejects.toThrow();
    await expect(tools.get("storyboard_rerun")!({ taskId: "t1", step, idempotencyKey: "a".repeat(81) })).rejects.toThrow();
  });

  it("reports a repo's preview auto-start config", async () => {
    const { dashboard, tools } = setup();
    const get = vi.spyOn(dashboard, "get").mockResolvedValue({ repo: "app", autoStart: false, reason: "no config", running: [] });
    await tools.get("storyboard_preview_status")!({ repo: "app" });
    expect(get).toHaveBeenLastCalledWith("/api/storyboard/preview", { repo: "app" });
  });
});

it.each([undefined, false, true])("start-auto forwards the optional pauseAfterPlan=%s without changing its result", async (pauseAfterPlan) => {
  const { dashboard, tools } = setup();
  vi.spyOn(dashboard, "get").mockResolvedValue({ settings });
  const post = vi.spyOn(dashboard, "post").mockResolvedValue({ runId: "plan-run" });
  const result = await tools.get("storyboard_start_auto")!({ taskId: "t", taskDate: "2026-10-19", ...(pauseAfterPlan !== undefined ? { pauseAfterPlan } : {}) });
  const body = post.mock.calls[0][1] as Record<string, unknown>;
  expect(body.pauseAfterPlan).toBe(pauseAfterPlan);
  expect(Object.hasOwn(body, "pauseAfterPlan")).toBe(pauseAfterPlan !== undefined);
  expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({ runId: "plan-run", tiers: settings.steps, savedAsDefaults: false });
});

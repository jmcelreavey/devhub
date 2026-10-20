import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), start: vi.fn(), get: vi.fn(), list: vi.fn(), reconcile: vi.fn(), summary: vi.fn(), mode: vi.fn(), answer: vi.fn() }));
vi.mock("@/lib/api-utils", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api-utils")>()), requireDashboardAuth: mocks.auth }));
vi.mock("@/lib/storyboard/orchestrator", () => ({
  startOrchestration: mocks.start, getOrchestration: mocks.get, listOrchestrationSummaries: mocks.list, orchestrationSummary: mocks.summary,
  reconcileOrchestrations: mocks.reconcile,
  setOrchestrationMode: mocks.mode, answerRepoQuestion: mocks.answer,
}));

import { StoryboardError } from "@/lib/storyboard/errors";
import { DEFAULT_MODEL_TIERS } from "@/lib/storyboard/model-tiers-shared";
import { GET, POST } from "./route";

const TASK = "11111111-2222-3333-4444-555555555555";
const post = (body: unknown) => POST(new NextRequest("http://localhost:1337/api/storyboard/orchestrate", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));
const get = (query = "") => GET(new NextRequest(`http://localhost:1337/api/storyboard/orchestrate${query}`));
const valid = { action: "start", taskId: TASK, taskDate: "2026-10-15", idempotencyKey: "abcdef0123456789" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockReturnValue({ ok: true });
  mocks.reconcile.mockResolvedValue([]);
  mocks.summary.mockReturnValue({ taskId: TASK, status: "running" });
});

describe("POST /api/storyboard/orchestrate", () => {
  it("forwards optional tier effort through the start schema", async () => {
    mocks.start.mockResolvedValue({ orchestration: { taskId: TASK }, created: true });
    const tiers = { ...DEFAULT_MODEL_TIERS, tiers: { ...DEFAULT_MODEL_TIERS.tiers, heavy: { provider: "claude", model: "opus", effort: "max" } } };
    expect((await post({ ...valid, tiers })).status).toBe(201);
    expect(mocks.start).toHaveBeenCalledWith({ ...valid, tiers }, { origin: "http://localhost:1337" });
  });

  it("validates and forwards optional launch settings without changing old requests", async () => {
    mocks.start.mockResolvedValue({ orchestration: { taskId: TASK }, created: true });
    const options = { instructions: "Keep compatibility", worktree: true, pauseAfterPlan: true, stepOverrides: {
      plan: { provider: "codex", model: "gpt-6-sol", effort: "high" },
      implement: { effort: "high" }, review: { provider: "claude", model: "opus", effort: "max" },
    } };
    expect((await post({ ...valid, ...options })).status).toBe(201);
    expect(mocks.start).toHaveBeenCalledWith({ ...valid, ...options }, { origin: "http://localhost:1337" });
    expect((await post({ ...valid, instructions: "x".repeat(32001) })).status).toBe(400);
    expect((await post({ ...valid, worktree: "yes" })).status).toBe(400);
    expect((await post({ ...valid, stepOverrides: { implement: { effort: "x".repeat(81) } } })).status).toBe(400);
    expect((await post({ ...valid, stepOverrides: { implement: { provider: "codex" } } })).status).toBe(400);
  });
  it("starts with the request origin and answers 201 when created", async () => {
    mocks.start.mockResolvedValue({ orchestration: { taskId: TASK }, created: true, replayed: false, runId: "run-1", dispatchError: null });
    const response = await post(valid);
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.start).toHaveBeenCalledWith(valid, { origin: "http://localhost:1337" });
    expect(await response.json()).toMatchObject({ created: true, runId: "run-1", summary: { status: "running" } });
  });

  it("answers 200 for a task already on auto", async () => {
    mocks.start.mockResolvedValue({ orchestration: { taskId: TASK }, created: false, replayed: false, runId: null, dispatchError: null });
    expect((await post(valid)).status).toBe(200);
  });

  it.each([
    [{ ...valid, taskId: "../etc" }],
    [{ ...valid, taskDate: "15/10/2026" }],
    [{ ...valid, idempotencyKey: "short" }],
    [{ ...valid, action: "merge" }],
    [{ taskId: TASK }],
  ])("rejects an invalid body without starting: %o", async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("routes the Auto/Manual switch and the repo answer", async () => {
    mocks.mode.mockResolvedValue({ orchestration: { taskId: TASK }, runId: null, cancelled: "signalled", dispatchError: null });
    const mode = { action: "mode", taskId: TASK, mode: "manual", idempotencyKey: "abcdef0123456789" };
    expect((await post(mode)).status).toBe(200);
    expect(mocks.mode).toHaveBeenCalledWith(mode, { origin: "http://localhost:1337" });
    mocks.answer.mockResolvedValue({ orchestration: { taskId: TASK }, created: false, replayed: false, runId: "run-2", dispatchError: null });
    const answer = { action: "answer-repo", taskId: TASK, taskDate: "2026-10-15", idempotencyKey: "abcdef0123456789", cwd: "/Users/x/app" };
    expect(await (await post(answer)).json()).toMatchObject({ runId: "run-2" });
    expect((await post({ ...mode, mode: "sideways" })).status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("maps storyboard errors to their status", async () => {
    mocks.start.mockRejectedValue(new StoryboardError("That task is closed.", 409));
    const response = await post(valid);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "That task is closed." });
  });

  it("requires dashboard authentication", async () => {
    mocks.auth.mockReturnValue({ ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) });
    expect((await post(valid)).status).toBe(403);
    expect(mocks.start).not.toHaveBeenCalled();
  });
});

describe("GET /api/storyboard/orchestrate", () => {
  it("lists summaries without a task ID", async () => {
    mocks.list.mockReturnValue({ orchestrations: [], errors: [] });
    expect(await (await get()).json()).toEqual({ orchestrations: [], errors: [] });
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
  });

  it("returns one record with its summary", async () => {
    mocks.get.mockReturnValue({ taskId: TASK });
    const body = await (await get(`?taskId=${TASK}`)).json();
    expect(body).toEqual({ orchestration: { taskId: TASK }, summary: { taskId: TASK, status: "running" } });
  });

  it("rejects an invalid task ID and reports a missing one as 404", async () => {
    expect((await get("?taskId=../x")).status).toBe(400);
    mocks.get.mockImplementation(() => { throw new StoryboardError("That task is not on auto.", 404); });
    expect((await get(`?taskId=${TASK}`)).status).toBe(404);
  });
});

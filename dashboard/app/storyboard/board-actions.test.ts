import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mutate } from "swr";
import { clearRun, completeTask, createCardNote, deleteBoardTask, retryAuto, retryCard, setCardStatus, setUiOverride, startAuto, undoCompleteTask } from "./board-actions";
import type { BoardCard } from "@/lib/storyboard/notes-board-shared";
import { ORCHESTRATIONS_KEY } from "@/lib/storyboard/use-orchestrations";
import { TASK_AGENT_RUNS_KEY } from "@/lib/tasks/use-task-agent-runs";

vi.mock("swr", () => ({ mutate: vi.fn() }));
const fetchMock = vi.fn();
const card = { taskId: "t1", date: "2026-10-10", notePath: "task-notes/2026-10-10-t1", status: "todo" } as BoardCard;
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue(Response.json({}));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("board actions", () => {
  it("requests plan review by default in the UI and preserves the explicit opt-out", async () => {
    await startAuto(card);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ pauseAfterPlan: true });
    await startAuto(card, { pauseAfterPlan: false });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ pauseAfterPlan: false });
  });
  it.each([true, false])("asks before stopping live work for a backward move (confirm=%s)", async (confirmed) => {
    const confirm = vi.fn(() => confirmed);
    vi.stubGlobal("window", { confirm });
    fetchMock.mockResolvedValueOnce(Response.json({ requiresConfirmation: true }, { status: 409 }));
    const result = await setCardStatus({ ...card, status: "in-progress" }, "todo", "work");
    expect(confirm).toHaveBeenCalledOnce();
    expect(result.ok).toBe(confirmed);
    expect(fetchMock).toHaveBeenCalledTimes(confirmed ? 2 : 1);
    if (confirmed) expect(JSON.parse(fetchMock.mock.lastCall![1].body)).toEqual({ taskId: "t1", status: "todo", stopActive: true });
  });
  it("refreshes what the header chip and the Tasks rows show after an action on a run or on auto mode", async () => {
    for (const act of [() => retryAuto("t1"), () => setUiOverride("t1", true), () => retryCard(card), () => clearRun("t1", "run-1")]) {
      vi.mocked(mutate).mockClear();
      await expect(act()).resolves.toEqual({ ok: true });
      expect(vi.mocked(mutate).mock.calls.map(([key]) => key)).toEqual([ORCHESTRATIONS_KEY, TASK_AGENT_RUNS_KEY]);
    }
  });

  it("refreshes them after a refused action too, since a 409 can still mean the state moved", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: "That task has finished on auto." }, { status: 409 }));
    await expect(retryAuto("t1")).resolves.toEqual({ ok: false, error: "That task has finished on auto." });
    expect(vi.mocked(mutate)).toHaveBeenCalledTimes(2);
  });

  it("reports a failed plan dispatch even when the start endpoint returns 201", async () => {
    fetchMock.mockResolvedValue(Response.json({ dispatchError: "Paseo is unavailable.", runId: null }, { status: 201 }));
    await expect(startAuto(card)).resolves.toEqual({ ok: false, error: "Paseo is unavailable." });
    expect(vi.mocked(mutate)).toHaveBeenCalledTimes(2);
  });

  it("refreshes runs after a move but not after note creation", async () => {
    await setCardStatus(card, "blocked");
    expect(mutate).toHaveBeenCalledTimes(2);
    vi.mocked(mutate).mockClear();
    await createCardNote({ ...card, notePath: null });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("scaffolds a note without recording a deliberate status move", async () => {
    await createCardNote({ ...card, notePath: null });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/tasks/note/sections", expect.objectContaining({ body: JSON.stringify({ taskId: "t1", date: "2026-10-10", op: "set_meta" }) }));
  });

  it.each([200, 404])("deletes a list task idempotently and refreshes task/link counts (%s)", async (status) => {
    fetchMock.mockResolvedValue(Response.json({}, { status }));
    expect(await deleteBoardTask("t1")).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/tasks", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ id: "t1" }) }));
    const refresh = vi.mocked(mutate).mock.calls[0][0] as (key: unknown) => boolean;
    expect(refresh("/api/tasks/jira-intake")).toBe(true);
    expect(refresh("/api/sidebar/counts")).toBe(true);
    expect(refresh("/api/jira/tickets")).toBe(false);
  });

  it("reports refused and uncertain deletion instead of claiming the task disappeared", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Still running" }, { status: 409 }));
    expect(await deleteBoardTask("t1")).toEqual({ ok: false, error: "Still running" });
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await deleteBoardTask("t1")).toMatchObject({ ok: false, error: expect.stringContaining("Refresh") });
  });
});

describe("task action duplicate guards", () => {
  it.each(["start", "retry", "auto-retry", "finish"])("two rapid %s clicks send one request", async (kind) => {
    let respond!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { respond = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const card = { taskId: `task-${kind}`, date: "2026-10-17" } as BoardCard;
    const action = () => kind === "start" ? startAuto(card) : kind === "retry" ? retryCard(card) : kind === "auto-retry" ? retryAuto(card.taskId) : completeTask(card.taskId, card.date);
    const first = action();
    const second = action();
    expect(first).toBe(second);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    respond(Response.json({}));
    await Promise.all([first, second]);
  });

  it("Finish always requests completion, including after the first request settled; Undo explicitly reopens", async () => {
    fetchMock.mockImplementation(async () => Response.json({ done: true }));
    vi.stubGlobal("fetch", fetchMock);
    await completeTask("finish", "2026-10-17");
    await completeTask("finish", "2026-10-17");
    await undoCompleteTask("finish", "2026-10-17");
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body))).toEqual([
      { id: "finish", date: "2026-10-17", completion: true },
      { id: "finish", date: "2026-10-17", completion: true },
      { id: "finish", date: "2026-10-17", completion: false },
    ]);
  });

  it("releases failed requests so an explicit retry is possible", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await retryAuto("failed")).toMatchObject({ ok: false });
    expect(await retryAuto("failed")).toMatchObject({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

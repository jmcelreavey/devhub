import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRun } from "@/lib/agent-runs/store";
import type { TaskIndex } from "@/lib/tasks/task-index";
import type { Task } from "@/lib/tasks/types";
import type { PaseoAgent } from "@getpaseo/client";

const mock = vi.hoisted(() => ({ setWorkspacePinned: vi.fn(), updateAgentRunStatus: vi.fn(), readNote: vi.fn() }));
vi.mock("@/lib/vault/vault-registry", () => ({ getVaultStorage: () => ({ read: mock.readNote }) }));
vi.mock("./client", () => ({
  paseoUrl: () => "ws://127.0.0.1:6767/ws",
  withPaseo: async (fn: (session: unknown) => Promise<unknown>) => fn({ daemon: { setWorkspacePinned: mock.setWorkspacePinned } }),
}));
vi.mock("@/lib/agent-runs/store", () => ({ updateAgentRunStatus: mock.updateAgentRunStatus }));
import { paseoTurnOutcome, releaseTaskWorkspacePin, taskPinReleased } from "./lifecycle";

type Entry = Parameters<typeof paseoTurnOutcome>[2][number];

const run = { spec: { createdAt: Date.now() }, status: { messageId: "devhub-run-1" } } as AgentRun;
const idle = { status: "idle", pendingPermissions: [], lastUsage: { inputTokens: 18, outputTokens: 1079, totalCostUsd: 0.05 } } as unknown as PaseoAgent;

function entry(item: Entry["item"]): Entry {
  return { provider: "claude", item, timestamp: "", seqStart: 0, seqEnd: 0, sourceSeqRanges: [], collapsed: [] } as unknown as Entry;
}
const mine = entry({ type: "user_message", text: "do it", clientMessageId: "devhub-run-1" });

describe("paseoTurnOutcome", () => {
  it("does not mistake a Cursor connection failure after progress for a completed result", () => {
    const entries = [mine, entry({ type: "assistant_message", text: "I'll review the diff.", messageId: "progress" }),
      entry({ type: "assistant_message", text: "Error: RetriableError: Connection stalled", messageId: "error" })];
    expect(paseoTurnOutcome(run, idle, entries)).toMatchObject({ state: "failed", error: "Error: RetriableError: Connection stalled" });
  });

  it("requires a fresh saved write-up before completing a PR review", () => {
    const review = { ...run, spec: { ...run.spec, activity: { action: "review", prUrl: "https://github.com/acme/app/pull/1", notePath: "pr-reviews/acme-app-1" } } } as AgentRun;
    const entries = [mine, entry({ type: "assistant_message", text: "Finished." })];
    mock.readNote.mockReturnValue(null);
    expect(paseoTurnOutcome(review, idle, entries)).toMatchObject({ state: "failed", error: expect.stringContaining("not saved") });
    mock.readNote.mockReturnValue({ content: "Actual review", modified: run.spec.createdAt - 1 });
    expect(paseoTurnOutcome(review, idle, entries).state).toBe("failed");
    mock.readNote.mockReturnValue({ content: "# PR title\n\n**PR:** [acme/app#1](https://github.com/acme/app/pull/1)\n\n## Links\n- [Repo](repo:app)\n\n## Review\n- \n\n## Notes\n- \n\n## Follow-ups\n- ", modified: Date.now() });
    expect(paseoTurnOutcome(review, idle, entries).state).toBe("failed");
    mock.readNote.mockReturnValue({ content: "# Review\n\nNo blocking findings. Tests pass.", modified: Date.now() });
    expect(paseoTurnOutcome(review, idle, entries).state).toBe("completed");
    mock.readNote.mockImplementationOnce(() => { throw new Error("Invalid JSON"); });
    expect(paseoTurnOutcome(review, idle, entries)).toMatchObject({ state: "failed", error: "The saved PR review note could not be read: Invalid JSON" });
  });

  it("keeps a steered run active and includes the result after its owner note", () => {
    const steered = { ...run, status: { ...run.status, steeringMessageIds: ["note-1"] } };
    const entries = [mine, entry({ type: "assistant_message", text: "Working" }), entry({ type: "user_message", text: "Note from John", clientMessageId: "note-1" }), entry({ type: "assistant_message", text: "Updated result" })];
    expect(paseoTurnOutcome(steered, { ...idle, status: "running" }, entries).state).toBe("running");
    expect(paseoTurnOutcome(steered, idle, entries)).toMatchObject({ state: "completed", resultText: "Working\n\nUpdated result" });
  });
  it("joins streamed assistant chunks and records usage", () => {
    const chunks = ["554", "608e init | yes", " | 19"].map((text) => entry({ type: "assistant_message", text, messageId: "msg_1" }));
    expect(paseoTurnOutcome(run, idle, [mine, ...chunks])).toMatchObject({
      state: "completed", resultText: "554608e init | yes | 19", inputTokens: 18, outputTokens: 1079, costUsd: 0.05,
    });
  });

  it("keeps text either side of a tool call as separate paragraphs", () => {
    const items = [entry({ type: "assistant_message", text: "I'll check." }), entry({ type: "tool_call" } as unknown as Entry["item"]), entry({ type: "assistant_message", text: "DONE" })];
    expect(paseoTurnOutcome(run, idle, [mine, ...items]).resultText).toBe("I'll check.\n\nDONE");
  });

  it("never infers success from idle alone, and never leaves an idle agent holding a slot", () => {
    expect(paseoTurnOutcome(run, idle, [mine])).toMatchObject({ state: "failed", finishedAt: expect.any(Number) });
    expect(paseoTurnOutcome(run, idle, [])).toMatchObject({ state: "failed", finishedAt: expect.any(Number) });
  });

  it("reports this turn's error, not the next turn's", () => {
    expect(paseoTurnOutcome(run, idle, [mine, entry({ type: "error", message: "rate limited" })])).toMatchObject({ state: "failed", error: "rate limited" });
    const next = [entry({ type: "assistant_message", text: "ok" }), entry({ type: "user_message", text: "again" }), entry({ type: "error", message: "later" })];
    expect(paseoTurnOutcome(run, idle, [mine, ...next])).toMatchObject({ state: "completed", resultText: "ok" });
  });

  it("maps live, errored and closed agents without reading the timeline", () => {
    expect(paseoTurnOutcome(run, { ...idle, status: "running" }, []).state).toBe("running");
    expect(paseoTurnOutcome(run, { ...idle, status: "initializing" }, []).state).toBe("starting");
    expect(paseoTurnOutcome(run, { ...idle, status: "running", pendingPermissions: [{ id: "p" }] } as unknown as PaseoAgent, []).state).toBe("needs-attention");
    expect(paseoTurnOutcome(run, { ...idle, status: "error", lastError: "boom" }, [])).toMatchObject({ state: "failed", error: "boom" });
    expect(paseoTurnOutcome(run, { ...idle, status: "closed" }, [])).toMatchObject({ state: "failed", error: "The Paseo agent was closed before DevHub saw a result." });
  });

  it("keeps the result of a turn that finished before its agent was closed", () => {
    const finished = [mine, entry({ type: "assistant_message", text: "all done" })];
    expect(paseoTurnOutcome(run, { ...idle, status: "closed" }, finished)).toMatchObject({ state: "completed", resultText: "all done" });
  });

  it("finishes the submitted turn while a later turn runs, without borrowing its usage", () => {
    const entries = [mine, entry({ type: "assistant_message", text: "original result" }), entry({ type: "user_message", text: "next" })];
    const result = paseoTurnOutcome(run, { ...idle, status: "running" }, entries);
    expect(result).toMatchObject({ state: "completed", resultText: "original result" });
    expect(result.costUsd).toBeUndefined();
    expect(paseoTurnOutcome(run, { ...idle, status: "error", lastError: "later failure" }, entries).state).toBe("completed");
  });

  it("reports a stuck initialization as needing attention", () => {
    const old = { ...run, spec: { ...run.spec, createdAt: Date.now() - 130_000 } };
    expect(paseoTurnOutcome(old, { ...idle, status: "initializing" }, []).state).toBe("needs-attention");
  });

  it("separates distinct assistant messages", () => {
    expect(paseoTurnOutcome(run, idle, [mine,
      entry({ type: "assistant_message", text: "first", messageId: "a" }),
      entry({ type: "assistant_message", text: "second", messageId: "b" }),
    ]).resultText).toBe("first\n\nsecond");
  });

  it("marks an acknowledged cancel as cancelled", () => {
    const cancelled = { ...run, status: { ...run.status, cancelRequestedAt: 1 } } as AgentRun;
    expect(paseoTurnOutcome(cancelled, idle, [mine, entry({ type: "assistant_message", text: "partial" })]).state).toBe("cancelled");
  });
});

describe("task workspace pins", () => {
  const taskRun = (action: string, createdAt: number, status: Partial<AgentRun["status"]> = {}) => ({
    spec: { createdAt, activity: { source: "interactive", action, taskId: "task-1" } },
    status: { connectionId: "ws://127.0.0.1:6767/ws", conversationId: "agent", pinnedWorkspaceId: "ws", ...status },
  }) as unknown as AgentRun;
  const index = (task?: Partial<Task>): TaskIndex => ({
    byId: new Map(task ? [["task-1", { date: "2026-09-25", task: { id: "task-1", text: "Ship it", done: false, createdAt: "", startDate: "2026-09-25", rank: "1", ...task } }]] : []),
    aliases: new Map(),
  });
  const plan = taskRun("plan", 1);
  const implement = taskRun("implement", 2);

  beforeEach(() => {
    vi.resetAllMocks();
    mock.updateAgentRunStatus.mockImplementation((run: AgentRun, patch: Partial<AgentRun["status"]>) => ({ ...run, status: { ...run.status, ...patch } }));
  });

  it("keeps a plan pinned until implementation starts, then only the implement chat", () => {
    expect(taskPinReleased(plan, [plan], index({}))).toBe(false);
    expect(taskPinReleased(plan, [plan, taskRun("implement", 2, { conversationId: undefined })], index({}))).toBe(false);
    expect(taskPinReleased(plan, [plan, implement], index({}))).toBe(true);
    expect(taskPinReleased(implement, [plan, implement], index({}))).toBe(false);
  });

  it("keeps only the newest chat of a task pinned, whatever step it is", () => {
    const retry = taskRun("implement", 3);
    const review = taskRun("review", 4);
    expect(taskPinReleased(implement, [plan, implement, retry], index({}))).toBe(true);
    expect(taskPinReleased(retry, [plan, implement, retry], index({}))).toBe(false);
    expect(taskPinReleased(retry, [implement, retry, review], index({}))).toBe(true);
    expect(taskPinReleased(review, [implement, retry, review], index({}))).toBe(false);
  });

  it("releases every chat once the task is done, abandoned or deleted", () => {
    expect(taskPinReleased(implement, [implement], index({ done: true }))).toBe(true);
    expect(taskPinReleased(implement, [implement], index({ abandonedAt: "2026-09-25T10:00:00.000Z" }))).toBe(true);
    expect(taskPinReleased(implement, [implement], index())).toBe(true);
  });

  it("unpins once and records it, retrying when Paseo is unavailable", async () => {
    mock.setWorkspacePinned.mockRejectedValueOnce(new Error("Paseo is unavailable."));
    expect(await releaseTaskWorkspacePin(plan, [plan, implement], index({}))).toBe(plan);
    const released = await releaseTaskWorkspacePin(plan, [plan, implement], index({}));
    expect(mock.setWorkspacePinned).toHaveBeenLastCalledWith("ws", false);
    expect(released.status.workspaceUnpinnedAt).toEqual(expect.any(Number));
    mock.setWorkspacePinned.mockClear();
    await releaseTaskWorkspacePin(released, [released, implement], index({}));
    expect(mock.setWorkspacePinned).not.toHaveBeenCalled();
  });

  it("treats a deleted workspace as already unpinned", async () => {
    mock.setWorkspacePinned.mockRejectedValue(new Error("Workspace not found"));
    expect((await releaseTaskWorkspacePin(implement, [implement], index({ done: true }))).status.workspaceUnpinnedAt).toEqual(expect.any(Number));
  });
});

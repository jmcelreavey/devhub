import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("node:fs", () => ({ default: { realpathSync: (value: string) => value } }));
vi.mock("@/lib/editor/workspace", () => ({ editorWorkspace: () => "/workspace", selectionPath: vi.fn() }));
vi.mock("@/lib/api-utils", async (original) => ({ ...await original<typeof import("@/lib/api-utils")>(), requireDashboardAuth: () => ({ ok: true }) }));
vi.mock("@/lib/agent-runs/dispatch", () => ({ AgentDispatchError: class extends Error { constructor(message: string, public status: number) { super(message); } }, dispatchAgentRun: vi.fn(async () => ({ id: "new" })) }));
vi.mock("@/lib/agent-runs/store", () => ({ listAgentRuns: () => [], readAgentRun: vi.fn(), toAgentRunSummary: (value: unknown) => value }));
vi.mock("@/lib/agent-runs/claims", () => ({ readAgentRequest: vi.fn() }));
vi.mock("@/lib/tasks/storage", () => ({ ensureTasksMigrated: vi.fn() }));
vi.mock("@/lib/tasks/task-index", () => ({ loadTaskIndex: () => ({ byId: new Map() }), currentTaskNode: (_index: unknown, id: string) => ({ task: { id }, date: "2026-10-09" }) }));
vi.mock("@/lib/paseo/lifecycle", () => ({ reconcileManagedRun: (value: unknown) => value }));
import { POST } from "./route";
import { dispatchAgentRun } from "@/lib/agent-runs/dispatch";
import { readAgentRun } from "@/lib/agent-runs/store";
import { readAgentRequest } from "@/lib/agent-runs/claims";
const selection = { workspaceId: "demo", relativePath: "a.ts", revision: "hash", ranges: "1–2", selectedText: "- old\n+ café", dirty: true, source: "staged" };
const send = { requestId: "cf4a52e5-53f1-4ba7-a360-d5c72698ff7d", question: "Why?", provider: "codex", taskId: "task" };
const request = (body: unknown) => new NextRequest("http://localhost/api/editor/selection", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => vi.clearAllMocks());
it("preview is local and cannot launch a conversation", async () => {
  expect((await POST(request({ selection }))).status).toBe(200);
  expect(dispatchAgentRun).not.toHaveBeenCalled();
});
it("dispatches a linked discussion in the exact checkout, without a new worktree", async () => {
  expect((await POST(request({ selection, send }))).status).toBe(200);
  expect(dispatchAgentRun).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/workspace", worktree: false, requestId: send.requestId, activity: expect.objectContaining({ taskId: "task", action: "discuss" }), prompt: expect.stringContaining("> - old\n> + café") }));
});
it("rejects a conversation in another worktree", async () => {
  vi.mocked(readAgentRun).mockReturnValue({ spec: { cwd: "/other" }, status: { conversationId: "chat" } } as ReturnType<typeof readAgentRun>);
  expect((await POST(request({ selection, send: { ...send, runId: "other" } }))).status).toBe(409);
  expect(dispatchAgentRun).not.toHaveBeenCalled();
});
it("does not reuse a claimed request for another task", async () => {
  vi.mocked(readAgentRequest).mockReturnValue("prior");
  vi.mocked(readAgentRun).mockReturnValue({ spec: { cwd: "/workspace", provider: "codex", activity: { taskId: "another-task" } }, status: {} } as ReturnType<typeof readAgentRun>);
  expect((await POST(request({ selection, send }))).status).toBe(409);
  expect(dispatchAgentRun).not.toHaveBeenCalled();
});

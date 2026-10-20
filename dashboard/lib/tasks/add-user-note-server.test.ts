import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ resolve: vi.fn(), active: vi.fn(), read: vi.fn(), update: vi.fn(), auto: vi.fn(), stop: vi.fn(), resume: vi.fn(), continueAuto: vi.fn(), sections: vi.fn(), send: vi.fn(), fetchAgent: vi.fn() }));
vi.mock("@/lib/content/dirs", () => ({ getActiveTasksDir: () => "/tmp/task-note-tests" }));
vi.mock("@/lib/plugins/lock", () => ({ withPluginMutationLock: async (_path: string, work: () => Promise<unknown>) => work() }));
vi.mock("@/lib/agent-runs/store", () => ({ readAgentRun: calls.read, updateAgentRunStatus: calls.update }));
vi.mock("@/lib/storyboard/stop-task-work", () => ({ activeTaskRuns: calls.active, stopTaskWork: calls.stop }));
vi.mock("@/lib/storyboard/orchestration-store", () => ({ readOrchestration: calls.auto }));
vi.mock("@/lib/storyboard/orchestrator", () => ({ setOrchestrationMode: calls.continueAuto }));
vi.mock("@/lib/paseo/client", () => ({ paseoUrl: () => "ws://local", withPaseo: async (work: (session: unknown) => Promise<unknown>) => work({ daemon: { sendAgentMessage: calls.send, fetchAgent: calls.fetchAgent } }) }));
vi.mock("./reopen-task", () => ({ resolveReopenTask: calls.resolve }));
vi.mock("./resume-task-agent", () => ({ resumeTaskAgent: calls.resume }));
vi.mock("./task-note-sections", async () => ({ ...await vi.importActual<typeof import("@shared/task-note/sections.ts")>("@shared/task-note/sections.ts"), updateTaskNoteSections: calls.sections }));

import { addTaskUserNote, taskNoteCapability } from "./add-user-note-server";

const note = { id: "n1", text: "Keep the API", at: "2026-10-19T10:00:00.000Z" };
const task = { id: "task-1", startDate: "2026-10-19" };
const run = () => ({ spec: { provider: "codex", runtime: "paseo" }, status: { state: "running", connectionId: "ws://local", messageId: "m1", conversationId: "session-1", sessionId: "session-1", steeringMessageIds: [] as string[] } });

beforeEach(() => {
  vi.resetAllMocks();
  calls.resolve.mockResolvedValue(task);
  calls.active.mockReturnValue([]);
  calls.read.mockReturnValue(null);
  calls.auto.mockReturnValue(null);
  calls.sections.mockReturnValue({ view: { userNotes: [note] } });
  calls.fetchAgent.mockResolvedValue({ agent: { status: "running", capabilities: { supportsSessionPersistence: true } } });
  calls.resume.mockResolvedValue({ run: { id: "resumed" } });
  calls.continueAuto.mockResolvedValue({ runId: "auto-next" });
});

describe("task note runtime wiring", () => {
  it("resolves a ticket, saves through the section store and leaves idle work alone", async () => {
    const result = await addTaskUserNote({ taskId: "PTF-1", text: note.text }, "http://localhost");
    expect(calls.resolve).toHaveBeenCalledWith("PTF-1");
    expect(calls.sections).toHaveBeenCalledWith({ taskId: task.id }, { op: "add_user_note", text: note.text });
    expect(result.agent.mode).toBe("none");
    expect(calls.stop).not.toHaveBeenCalled();
  });
  it("uses live steering without cancelling and records the message as part of this turn", async () => {
    calls.active.mockReturnValue([{ runId: "r1" }]);
    calls.read.mockReturnValue(run());
    const result = await addTaskUserNote({ taskId: task.id, text: note.text, updateAgent: true }, "http://localhost");
    expect(result.agent.mode).toBe("followup");
    expect(calls.send).toHaveBeenCalledWith("session-1", expect.stringContaining("Note from John"), { messageId: "devhub-note-n1", activeTurnBehavior: "steer" });
    expect(calls.update).toHaveBeenCalledWith(expect.anything(), { steeringMessageIds: ["devhub-note-n1"] });
    expect(calls.stop).not.toHaveBeenCalled();
  });
  it("reuses the saved note and does not resend an acknowledged live message", async () => {
    calls.active.mockReturnValue([{ runId: "r1" }]);
    const current = run(); current.status.steeringMessageIds = ["devhub-note-n1"];
    calls.read.mockReturnValue(current);
    await addTaskUserNote({ taskId: task.id, text: note.text, updateAgent: true, noteId: note.id }, "http://localhost");
    expect(calls.sections).toHaveBeenCalledOnce();
    expect(calls.sections).toHaveBeenCalledWith({ taskId: task.id }, { op: "read" });
    expect(calls.send).not.toHaveBeenCalled();
  });
  it("keeps a saved note when steering is refused without falling back to a stop", async () => {
    calls.active.mockReturnValue([{ runId: "r1" }]); calls.read.mockReturnValue(run());
    calls.send.mockRejectedValue(new Error("Live steering is unsupported"));
    const result = await addTaskUserNote({ taskId: task.id, text: note.text, updateAgent: true }, "http://localhost");
    expect(result.saved).toBe(true); expect(result.agent.error).toContain("unsupported");
    expect(calls.stop).not.toHaveBeenCalled();
  });
  it("stops unsupported runs then resumes in the same task with owner guidance", async () => {
    calls.active.mockReturnValue([{ runId: "r1" }]);
    calls.read.mockReturnValue({ ...run(), spec: { provider: "codex", runtime: "terminal" } });
    const result = await addTaskUserNote({ taskId: task.id, text: note.text, updateAgent: true }, "http://localhost");
    expect(result.agent).toEqual({ mode: "restarted", runId: "resumed" });
    expect(calls.resume).toHaveBeenCalledWith({ taskId: task.id, date: task.startDate, origin: "http://localhost", guidance: expect.stringContaining(note.text) });
    expect(calls.stop.mock.invocationCallOrder[0]).toBeLessThan(calls.resume.mock.invocationCallOrder[0]);
    expect(result.capability.confirmNeeded).toBe(false);
  });
  it("continues Auto after a partially stopped attempt instead of switching to plain resume", async () => {
    calls.active.mockReturnValue([{ runId: "r1" }]);
    calls.read.mockReturnValue({ ...run(), spec: { provider: "codex", runtime: "terminal" } });
    calls.auto.mockReturnValue({ status: "paused-manual", runIds: ["r1"], auto: { pauseAfterPlan: true } });
    const result = await addTaskUserNote({ taskId: task.id, text: note.text, updateAgent: true }, "http://localhost");
    expect(result.agent.mode).toBe("auto-continued");
    expect(calls.continueAuto).toHaveBeenCalledWith(expect.objectContaining({ mode: "auto", taskId: task.id, guidance: expect.stringContaining(note.text) }), { origin: "http://localhost" });
    expect(calls.resume).not.toHaveBeenCalled();
  });
  it("does not infer a live connection from a foreign session", async () => {
    calls.active.mockReturnValue([{ runId: "r1" }]);
    const current = run(); current.status.connectionId = "ws://elsewhere";
    calls.read.mockReturnValue(current);
    expect(await taskNoteCapability(task.id)).toMatchObject({ running: true, liveFollowup: false, confirmNeeded: false });
  });
  it("checks the running session's advertised resume support", async () => {
    calls.active.mockReturnValue([{ runId: "r1" }]); calls.read.mockReturnValue(run());
    calls.fetchAgent.mockResolvedValue({ agent: { status: "running", capabilities: { supportsSessionPersistence: false } } });
    expect(await taskNoteCapability(task.id)).toMatchObject({ running: true, liveFollowup: false });
  });
  it("refuses handed-off notes, including saved-note delivery retries", async () => {
    calls.resolve.mockResolvedValue({ ...task, handoff: { status: "accepted" } });
    await expect(addTaskUserNote({ taskId: task.id, text: note.text, noteId: note.id, updateAgent: true }, "http://localhost")).rejects.toThrow(/read-only/);
    expect(calls.sections).not.toHaveBeenCalled(); expect(calls.send).not.toHaveBeenCalled();
  });
});

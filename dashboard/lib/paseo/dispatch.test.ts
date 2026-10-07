import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRun } from "@/lib/agent-runs/store";
import type { PaseoLaunch } from "./launch";

const mock = vi.hoisted(() => ({
  fetchAgent: vi.fn(), applyAgentConfig: vi.fn(), send: vi.fn(), create: vi.fn(),
  openWorkspace: vi.fn(), setTitle: vi.fn(), currentWorkspace: vi.fn(), workspaceCreate: vi.fn(),
  createWorkspace: vi.fn(), setWorkspacePinned: vi.fn(),
}));
vi.mock("./client", () => ({ withPaseo: async (fn: (session: unknown) => Promise<unknown>) => fn({
  daemon: { fetchAgent: mock.fetchAgent, applyAgentConfig: mock.applyAgentConfig, setWorkspacePinned: mock.setWorkspacePinned },
  api: { agents: { create: mock.create, ref: () => ({ send: mock.send }) }, workspaces: { open: mock.openWorkspace, create: mock.createWorkspace } },
}) }));
import { startPaseoAgent } from "./dispatch";

const onSubmission = vi.fn();
const run = { spec: { id: "run-one", cwd: "/repo", title: "Task" } } as AgentRun;
const launch: PaseoLaunch = { provider: "cursor", model: "model[effort=high]", config: { provider: "cursor/model", modeId: "agent", thinkingOptionId: "high" }, env: {}, autoconfirmPermissions: true };
beforeEach(() => {
  vi.resetAllMocks();
  mock.create.mockResolvedValue({ id: "agent" });
  mock.workspaceCreate.mockResolvedValue({ id: "agent" });
  mock.currentWorkspace.mockReturnValue({ title: null });
  const handle = { id: "ws", current: mock.currentWorkspace, setTitle: mock.setTitle, agents: { create: mock.workspaceCreate } };
  mock.openWorkspace.mockResolvedValue(handle);
  mock.createWorkspace.mockResolvedValue(handle);
  mock.fetchAgent.mockResolvedValue({ agent: { status: "idle", pendingPermissions: [] } });
});
describe("Paseo dispatch names", () => {
  const isolated = { ...run, spec: { ...run.spec, title: "Implement · PTF-5014 · Analytics overlay", worktree: { path: "/repo", repoRoot: "/main", branch: "feature" } } };
  it("names an isolated workspace before starting the named agent", async () => {
    await startPaseoAgent({ run: isolated, launch, onSubmission, prompt: "Use the implement skill" });
    expect(mock.setTitle).toHaveBeenCalledWith(isolated.spec.title);
    expect(mock.workspaceCreate).toHaveBeenCalledWith(expect.objectContaining({ title: isolated.spec.title, prompt: "Use the implement skill" }));
    expect(mock.setTitle.mock.invocationCallOrder[0]).toBeLessThan(onSubmission.mock.invocationCallOrder[0]);
  });
  it("preserves a user workspace name", async () => {
    mock.currentWorkspace.mockReturnValue({ title: "My release work" });
    await startPaseoAgent({ run: isolated, launch, onSubmission, prompt: "Implement" });
    expect(mock.setTitle).not.toHaveBeenCalled();
    expect(mock.workspaceCreate).toHaveBeenCalled();
  });
  it("names the chat without renaming a shared checkout", async () => {
    await startPaseoAgent({ run, launch, onSubmission, prompt: "Plan" });
    expect(mock.openWorkspace).not.toHaveBeenCalled();
    expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ title: "Task" }));
  });
  it("does not submit a prompt if workspace naming fails", async () => {
    mock.setTitle.mockRejectedValue(new Error("Naming failed"));
    await expect(startPaseoAgent({ run: isolated, launch, onSubmission, prompt: "Implement" })).rejects.toThrow("Naming failed");
    expect(onSubmission).not.toHaveBeenCalled();
    expect(mock.workspaceCreate).not.toHaveBeenCalled();
  });
});

describe("Paseo task pins", () => {
  const plan = { ...run, spec: { ...run.spec, title: "Plan · PTF-5014 · Analytics overlay", activity: { source: "interactive", action: "plan", taskId: "task-1" } } } as AgentRun;
  const implement = { ...run, spec: { ...run.spec, activity: { source: "interactive", action: "implement", taskId: "task-1" }, worktree: { path: "/repo", repoRoot: "/main", branch: "feature" } } } as AgentRun;
  it("gives a plan on a shared checkout its own titled, pinned workspace", async () => {
    mock.currentWorkspace.mockReturnValue({ title: plan.spec.title, pinnedAt: null });
    const started = await startPaseoAgent({ run: plan, launch, onSubmission, prompt: "Plan" });
    expect(mock.createWorkspace).toHaveBeenCalledWith({ title: plan.spec.title, source: { kind: "directory", path: "/repo" } });
    expect(mock.workspaceCreate).toHaveBeenCalled();
    expect(mock.setWorkspacePinned).toHaveBeenCalledWith("ws", true);
    expect(started.pinnedWorkspaceId).toBe("ws");
  });
  it("pins an implement worktree without claiming a pin the user already made", async () => {
    expect((await startPaseoAgent({ run: implement, launch, onSubmission, prompt: "Implement" })).pinnedWorkspaceId).toBe("ws");
    mock.currentWorkspace.mockReturnValue({ title: "Mine", pinnedAt: "2026-09-25T10:00:00.000Z" });
    mock.setWorkspacePinned.mockClear();
    expect((await startPaseoAgent({ run: implement, launch, onSubmission, prompt: "Implement" })).pinnedWorkspaceId).toBeUndefined();
    expect(mock.setWorkspacePinned).not.toHaveBeenCalled();
  });
  it("still starts the chat when pinning fails", async () => {
    mock.setWorkspacePinned.mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const started = await startPaseoAgent({ run: plan, launch, onSubmission, prompt: "Plan" });
    expect(started).toEqual({ agentId: "agent", messageId: "devhub-run-one" });
  });
});

describe("Paseo follow-ups", () => {
  it("applies the selected model and thinking before sending a follow-up", async () => {
    await startPaseoAgent({ run, launch, onSubmission, prompt: "Continue", resumeAgentId: "agent" });
    expect(mock.applyAgentConfig).toHaveBeenCalledWith("agent", expect.objectContaining({ modelId: "model", thinkingOptionId: "high", modeId: "agent" }));
    expect(mock.send).toHaveBeenCalledWith("Continue", { messageId: "devhub-run-one" });
    expect(mock.applyAgentConfig.mock.invocationCallOrder[0]).toBeLessThan(onSubmission.mock.invocationCallOrder[0]);
    expect(onSubmission.mock.invocationCallOrder[0]).toBeLessThan(mock.send.mock.invocationCallOrder[0]);
  });
  it("does not interrupt a chat that became busy outside DevHub", async () => {
    mock.fetchAgent.mockResolvedValue({ agent: { status: "running", pendingPermissions: [] } });
    await expect(startPaseoAgent({ run, launch, onSubmission, prompt: "Continue", resumeAgentId: "agent" })).rejects.toThrow("busy");
    expect(mock.send).not.toHaveBeenCalled();
    expect(onSubmission).not.toHaveBeenCalled();
    expect(mock.applyAgentConfig).not.toHaveBeenCalled();
  });
});

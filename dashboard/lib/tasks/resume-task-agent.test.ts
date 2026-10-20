import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), handoff: vi.fn(), raw: vi.fn() }));
vi.mock("@/lib/agent-runs/dispatch", () => ({ dispatchAgentRun: mocks.dispatch, AgentDispatchError: class extends Error {} }));
vi.mock("@/lib/agent-runs/store", () => ({ readAgentRun: mocks.raw, toAgentRunSummary: (run: unknown) => run }));
vi.mock("@/lib/agent-runs/run-files", () => ({ readRunEvents: () => ({ events: [] }) }));
vi.mock("@/lib/paseo/providers", () => ({ listPaseoProviders: async () => [{ id: "codex", ready: true }], defaultPaseoProvider: () => "codex" }));
vi.mock("@/lib/repos/resolution", () => ({ resolveLocalGithubRepos: async () => [] }));
vi.mock("@/lib/tasks/reconcile-task-agent-sidecar", () => ({ reconcileTaskAgentRunSidecar: async () => undefined }));
vi.mock("@/lib/tasks/storage", () => ({ ensureTasksMigrated: async () => undefined, getTasks: () => [{ id: "task", text: "Task", startDate: "2026-10-18" }] }));
vi.mock("@/lib/tasks/task-agent-runs", () => ({ getTaskAgentHandoff: mocks.handoff, isActiveTaskAgentRunStatus: () => false }));
vi.mock("@/lib/tasks/task-pr-watch", () => ({ handleTaskPrAttention: vi.fn() }));
import { resumeTaskAgent } from "./resume-task-agent";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.raw.mockReturnValue({ spec: { id: "old", provider: "codex", runtime: "legacy-cli", cwd: "/repo", prompt: "Review only. Do not implement.", model: "review-model" }, status: {}, dir: "/runs/old" });
  mocks.handoff.mockReturnValue({ latestRun: { runId: "old", role: "review", status: "failed", provider: "codex" }, handoff: "Previous context" });
  mocks.dispatch.mockResolvedValue({ spec: { id: "new" } });
});
it("recovers the exact failed review with its instructions, role, model and guidance", async () => {
  await resumeTaskAgent({ taskId: "task", date: "2026-10-18", origin: "http://fixture", retryRunId: "old", guidance: "Retry the check" });
  expect(mocks.dispatch.mock.calls[0][0].prompt).toContain("set_status_update");
  expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining("Review only. Do not implement.\n\nUser guidance for this retry:\nRetry the check"), model: "review-model", activity: expect.objectContaining({ action: "review" }) }));
});
it("preserves existing default resume behaviour without the new recovery options", async () => {
  await resumeTaskAgent({ taskId: "task", date: "2026-10-18", origin: "http://fixture" });
  expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining("RESUME an in-progress DevHub task"), activity: expect.objectContaining({ action: "resume" }), model: undefined }));
});
it("refuses recovery if the failed run was replaced", async () => {
  await expect(resumeTaskAgent({ taskId: "task", date: "2026-10-18", origin: "http://fixture", retryRunId: "stale" })).rejects.toMatchObject({ status: 409 });
  expect(mocks.dispatch).not.toHaveBeenCalled();
});

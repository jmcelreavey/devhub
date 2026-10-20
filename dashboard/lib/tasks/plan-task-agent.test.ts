import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(), tasks: vi.fn(), handoff: vi.fn(), orchestration: vi.fn(), repos: vi.fn(),
}));
vi.mock("@/lib/agent-runs/dispatch", () => ({
  dispatchAgentRun: mocks.dispatch,
  AgentDispatchError: class extends Error { constructor(message: string, readonly status: number) { super(message); } },
}));
vi.mock("@/lib/agent-runs/store", () => ({ toAgentRunSummary: (run: { id: string }) => ({ id: run.id, state: "queued" }) }));
vi.mock("@/lib/repos/resolution", () => ({ resolveLocalGithubRepos: mocks.repos }));
vi.mock("@/lib/storyboard/orchestration-store", () => ({ readOrchestration: mocks.orchestration }));
vi.mock("@/lib/tasks/reconcile-task-agent-sidecar", () => ({ reconcileTaskAgentRunSidecar: vi.fn(async () => {}) }));
vi.mock("@/lib/tasks/storage", () => ({ ensureTasksMigrated: vi.fn(async () => {}), getTasks: mocks.tasks }));
vi.mock("@/lib/tasks/task-agent-runs", () => ({ getTaskAgentHandoff: mocks.handoff, isActiveTaskAgentRunStatus: (status: string) => status === "running" || status === "queued" }));
import { AgentDispatchError } from "@/lib/agent-runs/dispatch";
import { planTaskAgent, TaskAgentPlanError } from "./plan-task-agent";

const input = { taskId: "task-1", date: "2026-10-12", origin: "http://localhost:1337" };
const task = { id: "task-1", text: "Fix the ad slot fallback", done: false, jiraKey: "PTF-1", links: [{ kind: "repo", id: "acme/app", label: "app" }] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tasks.mockReturnValue([task]);
  mocks.handoff.mockReturnValue({ latestRun: null });
  mocks.orchestration.mockReturnValue(null);
  mocks.repos.mockResolvedValue([{ fullName: "acme/app", repo: { name: "app", path: "/repos/app" } }]);
  mocks.dispatch.mockResolvedValue({ id: "run-1" });
});

describe("planTaskAgent", () => {
  it("dispatches one read-only plan run in the linked repo and nothing else", async () => {
    expect(await planTaskAgent(input)).toEqual({ run: { id: "run-1", state: "queued" } });
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    const request = mocks.dispatch.mock.calls[0][0];
    expect(request).toMatchObject({ provider: "", cwd: "/repos/app", worktree: false, depth: 0, title: "Plan Fix the ad slot fallback", activity: { source: "interactive", action: "plan", taskId: "task-1", taskDate: "2026-10-12", repoName: "acme/app" } });
    expect(request.prompt).toContain("devhub-plan-write");
    expect(request.planScope).toEqual({ taskId: "task-1", date: "2026-10-12" });
    expect(request.prompt).toContain("task_plan_update");
    expect(request.prompt).toContain("Do not implement it.");
    expect(request.prompt).toContain("Read only");
    expect(request.prompt).toContain("Jira ticket: PTF-1.");
    expect(request.prompt).toContain("/api/tasks/implement/plan?taskId=task-1&date=2026-10-12");
  });

  it("forwards the caller's nesting depth so an agent can't plan its way past the recursion guard", async () => {
    await planTaskAgent({ ...input, depth: 1 });
    expect(mocks.dispatch.mock.calls[0][0].depth).toBe(1);
  });

  it("passes the chosen agent, model and effort, treating 'default' as the preferred agent", async () => {
    await planTaskAgent({ ...input, provider: "claude", model: "opus", effort: "high" });
    expect(mocks.dispatch.mock.calls[0][0]).toMatchObject({ provider: "claude", model: "opus", effort: "high" });
    await planTaskAgent({ ...input, provider: "default" });
    expect(mocks.dispatch.mock.calls[1][0].provider).toBe("");
  });

  it("an explicit cwd wins over the linked repo, and a task with no repo needs one", async () => {
    await planTaskAgent({ ...input, cwd: "/elsewhere" });
    expect(mocks.dispatch.mock.calls[0][0].cwd).toBe("/elsewhere");
    mocks.tasks.mockReturnValue([{ ...task, links: [] }]);
    await expect(planTaskAgent(input)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("link a repo") });
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an unknown task", () => mocks.tasks.mockReturnValue([]), 404],
    ["a closed task", () => mocks.tasks.mockReturnValue([{ ...task, done: true }]), 409],
    ["an abandoned task", () => mocks.tasks.mockReturnValue([{ ...task, abandonedAt: "2026-10-01" }]), 409],
    ["a run still going", () => mocks.handoff.mockReturnValue({ latestRun: { runId: "r9", status: "running" } }), 409],
    ["a task on auto", () => mocks.orchestration.mockReturnValue({ status: "running" }), 409],
  ])("refuses %s without starting anything", async (_name, arrange, status) => {
    arrange();
    await expect(planTaskAgent(input)).rejects.toMatchObject({ name: "TaskAgentPlanError", status });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("allows a task whose earlier auto run has stopped or whose last run finished", async () => {
    mocks.orchestration.mockReturnValue({ status: "stopped" });
    mocks.handoff.mockReturnValue({ latestRun: { runId: "r9", status: "done" } });
    await planTaskAgent(input);
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
  });

  it("rejects a bad date and turns a dispatch refusal into a plan error", async () => {
    await expect(planTaskAgent({ ...input, date: "tomorrow" })).rejects.toBeInstanceOf(TaskAgentPlanError);
    mocks.dispatch.mockRejectedValue(new AgentDispatchError("All of DevHub's agent slots are in use.", 429));
    await expect(planTaskAgent(input)).rejects.toMatchObject({ status: 429, message: expect.stringContaining("agent slots") });
  });

  it("lets an unexpected failure through rather than hiding it", async () => {
    mocks.dispatch.mockRejectedValue(new TypeError("boom"));
    await expect(planTaskAgent(input)).rejects.toThrow("boom");
  });
});

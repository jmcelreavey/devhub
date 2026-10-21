import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("node:os", async () => (await import("@/lib/test-home")).isolatedOs());

const paseo = vi.hoisted(() => ({ startPaseoAgent: vi.fn() }));
const providers = vi.hoisted(() => ({ listPaseoProviders: vi.fn() }));
const lifecycle = vi.hoisted(() => ({ reconcileCapacityRuns: vi.fn(async () => undefined) }));
const checkout = vi.hoisted(() => ({ prepareImplementationCheckout: vi.fn(), checkoutPreparationPrompt: () => "Prepared checkout receipt" }));
vi.mock("./checkout", () => checkout);
const git = vi.hoisted(() => ({ gitHead: vi.fn(async () => "base-sha"), createRunWorktree: vi.fn() }));
const paseoClient = vi.hoisted(() => ({ openPaseoSession: vi.fn(async () => ({ close: async () => undefined })) }));
vi.mock("@/lib/paseo/providers", () => providers);
vi.mock("@/lib/paseo/dispatch", () => paseo);
vi.mock("@/lib/paseo/lifecycle", () => lifecycle);
vi.mock("@/lib/paseo/managed", () => ({ preferredPaseoProvider: () => "claude" }));
vi.mock("@/lib/paseo/client", () => ({ paseoUrl: () => "ws://127.0.0.1:6767/ws", openPaseoSession: paseoClient.openPaseoSession }));
vi.mock("@/lib/agent-runs/git", () => git);
vi.mock("@/lib/tasks/task-agent-runs", () => ({ upsertTaskAgentRun: vi.fn(async () => undefined), syncTaskAgentRunFromAgentState: vi.fn(async () => undefined) }));
vi.mock("@/lib/tasks/run-snapshot", () => ({ recordRunSnapshot: vi.fn(async () => false) }));
import { dispatchAgentRun } from "./dispatch";
import { listAgentRuns, readAgentRun, updateAgentRunStatus } from "./store";
import { createTask } from "@shared/tasks/store.ts";
import { getActiveTasksDir } from "@/lib/content/dirs";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.homedir(), ".devhub-dispatch-test-"));
  vi.stubEnv("DEVHUB_AGENT_RUNS_DIR", path.join(root, "runs"));
  vi.stubEnv("NOTES_DIR", path.join(root, "notes"));
  vi.stubEnv("DEVHUB_AGENT_ALLOWED_ROOTS", root);
  vi.stubEnv("DEVHUB_AGENT_MAX_RUNS", "6");
  vi.clearAllMocks();
  checkout.prepareImplementationCheckout.mockReset();
  checkout.prepareImplementationCheckout.mockImplementation(async (_cwd, _id, options) => {
    const receipt = { originalBranch: "old-work", originalHead: "old", branch: "main", stashMessage: "saved work", stashSha: "stash-sha", baseSha: "fresh-main" };
    options.record(receipt);
    return receipt;
  });
  lifecycle.reconcileCapacityRuns.mockResolvedValue(undefined);
  providers.listPaseoProviders.mockResolvedValue([{ id: "claude", ready: true, label: "Claude", models: ["haiku"] }]);
  paseo.startPaseoAgent.mockImplementation(async ({ run, resumeAgentId, onSubmission }) => {
    onSubmission(`devhub-${run.spec.id}`);
    return { agentId: resumeAgentId ?? "agent-1", messageId: `devhub-${run.spec.id}` };
  });
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(root, { recursive: true, force: true }); });
const input = () => ({ provider: "claude", model: "haiku", prompt: "Synthetic test", cwd: root, depth: 0, worktree: false, requestId: "one-action" });

describe("durable Paseo dispatch", () => {
  it("prepares a fresh implementation before starting Paseo and records the recovery receipt", async () => {
    const run = await dispatchAgentRun({ ...input(), activity: { source: "interactive", action: "implement" } });
    expect(checkout.prepareImplementationCheckout).toHaveBeenCalledTimes(1);
    expect(run.spec).toMatchObject({ baseSha: "fresh-main", checkoutPreparation: { originalBranch: "old-work", stashSha: "stash-sha" } });
    expect(paseo.startPaseoAgent).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining("Prepared checkout receipt") }));
  });

  it("never starts an agent when checkout preparation fails", async () => {
    checkout.prepareImplementationCheckout.mockRejectedValueOnce(new Error("main has diverged"));
    const run = await dispatchAgentRun({ ...input(), activity: { source: "interactive", action: "implement" } });
    expect(run.status).toMatchObject({ state: "failed", error: "main has diverged" });
    expect(paseo.startPaseoAgent).not.toHaveBeenCalled();
  });

  it("keeps inherited implementation edits and their original baseline", async () => {
    const run = await dispatchAgentRun({ ...input(), prepareCheckout: true, inherit: { baseSha: "task-base" }, activity: { source: "interactive", action: "implement" } });
    expect(checkout.prepareImplementationCheckout).not.toHaveBeenCalled();
    expect(run.spec.baseSha).toBe("task-base");
  });

  it("leaves ordinary reviews and explicitly continued runs alone", async () => {
    await dispatchAgentRun({ ...input(), prepareCheckout: false, activity: { source: "interactive", action: "implement" } });
    await dispatchAgentRun({ ...input(), requestId: "review-only", activity: { source: "interactive", action: "review" } });
    expect(checkout.prepareImplementationCheckout).not.toHaveBeenCalled();
  });

  it("rejects dispatch for a pending pickup before starting an agent", async () => {
    vi.stubEnv("TASKS_DIR", path.join(root, "tasks"));
    const task = createTask(getActiveTasksDir(), { text: "Imported task", teamPickup: { handoffId: "h1", cwd: root, branch: "feature/task", status: "pending" } });
    await expect(dispatchAgentRun({ ...input(), activity: { source: "interactive", action: "implement", taskId: task.id } })).rejects.toMatchObject({ status: 409 });
    expect(paseo.startPaseoAgent).not.toHaveBeenCalled();
    expect(listAgentRuns()).toHaveLength(0);
  });
  it("claims concurrent retries once and returns the saved run after capacity fills", async () => {
    vi.stubEnv("DEVHUB_AGENT_MAX_RUNS", "1");
    const [first, retry] = await Promise.all([dispatchAgentRun(input()), dispatchAgentRun(input())]);
    expect(first.spec.id).toBe(retry.spec.id);
    expect(paseo.startPaseoAgent).toHaveBeenCalledTimes(1);
    expect(listAgentRuns()).toHaveLength(1);
    expect((await dispatchAgentRun(input())).spec.id).toBe(first.spec.id);
    expect(first.spec).toMatchObject({ runtime: "paseo", provider: "claude", model: "haiku" });
    expect(first.status).toMatchObject({ state: "running", conversationId: "agent-1", messageId: `devhub-${first.spec.id}` });
  });

  describe("nesting depth", () => {
    it("refuses a dispatch from inside an agent run, as before", async () => {
      await expect(dispatchAgentRun({ ...input(), depth: 1 })).rejects.toMatchObject({ status: 409 });
      expect(paseo.startPaseoAgent).not.toHaveBeenCalled();
    });

    it("lets an implement run start its assigned reviewer, one level down", async () => {
      const run = await dispatchAgentRun({ ...input(), requestId: "reviewer", depth: 1, reviewRun: true });
      expect(run.status.state).toBe("running");
      expect(paseo.startPaseoAgent.mock.calls[0][0].launch.env).toMatchObject({ DEVHUB_AGENT_DEPTH: "2" });
    });

    it("refuses anything started from inside the reviewer", async () => {
      await expect(dispatchAgentRun({ ...input(), depth: 2, reviewRun: true })).rejects.toMatchObject({ status: 409 });
      await expect(dispatchAgentRun({ ...input(), depth: 2 })).rejects.toMatchObject({ status: 409 });
    });

    it("keeps the exemption to one level when the configured limit is raised", async () => {
      vi.stubEnv("DEVHUB_AGENT_MAX_DEPTH", "2");
      await expect(dispatchAgentRun({ ...input(), depth: 3, reviewRun: true })).rejects.toMatchObject({ status: 409 });
      expect((await dispatchAgentRun({ ...input(), requestId: "ok", depth: 2, reviewRun: true })).status.state).toBe("running");
    });
  });

  it.each(["review", "pr-review"])("passes only the review MCP servers for %s runs", async (action) => {
    await dispatchAgentRun({ ...input(), requestId: `review-${action}`, activity: { source: "auto-review", action } });
    const launch = paseo.startPaseoAgent.mock.calls[0][0].launch;
    expect(Object.keys(launch.config.mcpServers ?? {}).every((name) => ["devhub", "lean-ctx"].includes(name))).toBe(true);
  });

  it("persists submission intent first and never resends after a lost acknowledgement", async () => {
    paseo.startPaseoAgent.mockImplementation(async ({ onSubmission }) => {
      onSubmission();
      expect(listAgentRuns()[0].status.submissionAttemptedAt).toBeGreaterThan(0);
      throw new Error("Timeout waiting for message (60000ms)");
    });
    const run = await dispatchAgentRun(input());
    expect(run.status.state).toBe("needs-attention");
    expect((await dispatchAgentRun(input())).spec.id).toBe(run.spec.id);
    expect(paseo.startPaseoAgent).toHaveBeenCalledTimes(1);
    await expect(dispatchAgentRun({ ...input(), prompt: "Different work" })).rejects.toMatchObject({ status: 409 });
  });

  it("releases capacity when preflight fails before submitting", async () => {
    vi.stubEnv("DEVHUB_AGENT_MAX_RUNS", "1");
    paseo.startPaseoAgent.mockRejectedValueOnce(new Error("The Paseo chat is busy."));
    const failed = await dispatchAgentRun(input());
    expect(failed.status).toMatchObject({ state: "failed", finishedAt: expect.any(Number) });
    expect(failed.status.submissionAttemptedAt).toBeUndefined();
    expect((await dispatchAgentRun({ ...input(), requestId: "next-attempt" })).status.state).toBe("running");
  });

  describe("agent limit", () => {
    it("re-checks the runs holding the limit before refusing, so stale ones don't block a start", async () => {
      vi.stubEnv("DEVHUB_AGENT_MAX_RUNS", "1");
      const stale = await dispatchAgentRun(input());
      updateAgentRunStatus(stale, { state: "needs-attention", error: "The turn stopped without a result." });
      lifecycle.reconcileCapacityRuns.mockImplementationOnce(async () => {
        for (const run of listAgentRuns()) updateAgentRunStatus(run, { state: "failed", finishedAt: Date.now() });
      });
      const next = await dispatchAgentRun({ ...input(), requestId: "after-stale" });
      expect(lifecycle.reconcileCapacityRuns).toHaveBeenCalledTimes(1);
      expect(next.status.state).toBe("running");
    });

    it("names what holds the limit and marks the refusal so a client can offer a way out", async () => {
      vi.stubEnv("DEVHUB_AGENT_MAX_RUNS", "1");
      await dispatchAgentRun({ ...input(), title: "Plan PTF-5207" });
      await expect(dispatchAgentRun({ ...input(), requestId: "over-limit" })).rejects.toMatchObject({
        status: 429, code: "capacity", message: expect.stringContaining("(running)"),
      });
      expect(paseo.startPaseoAgent).toHaveBeenCalledTimes(1);
    });

    it("does not touch Paseo while there is room", async () => {
      await dispatchAgentRun(input());
      expect(lifecycle.reconcileCapacityRuns).not.toHaveBeenCalled();
    });
  });

  it("sends a follow-up to the same agent and inherits its folder and baseline", async () => {
    const first = await dispatchAgentRun(input());
    updateAgentRunStatus(first, { state: "completed", finishedAt: Date.now() });
    const next = await dispatchAgentRun({ ...input(), requestId: "next-action", parentRunId: first.spec.id, resumeSessionId: "agent-1", prompt: "Continue" });
    expect(paseo.startPaseoAgent).toHaveBeenLastCalledWith(expect.objectContaining({ resumeAgentId: "agent-1", prompt: "Continue" }));
    expect(next.spec).toMatchObject({ cwd: first.spec.cwd, baseSha: "base-sha", parentRunId: first.spec.id });
    await expect(dispatchAgentRun({ ...input(), requestId: "bad-resume", parentRunId: first.spec.id, resumeSessionId: "another-agent" })).rejects.toMatchObject({ status: 400 });
  });

  it("refuses an unavailable provider before creating or claiming a run", async () => {
    providers.listPaseoProviders.mockResolvedValue([{ id: "claude", ready: false, error: "Provider failed to initialize" }]);
    await expect(dispatchAgentRun(input())).rejects.toMatchObject({ status: 400 });
    expect(listAgentRuns()).toHaveLength(0);
    expect(paseo.startPaseoAgent).not.toHaveBeenCalled();
  });

  it("refuses a second concurrent follow-up in the same chat", async () => {
    const first = await dispatchAgentRun(input());
    updateAgentRunStatus(first, { state: "completed", finishedAt: Date.now() });
    const resume = { ...input(), parentRunId: first.spec.id, resumeSessionId: "agent-1", prompt: "Continue" };
    const results = await Promise.allSettled([
      dispatchAgentRun({ ...resume, requestId: "followup-one" }),
      dispatchAgentRun({ ...resume, requestId: "followup-two" }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { status: 409 } });
  });

  it("falls back to the Connection tab's agent when the caller names none", async () => {
    const run = await dispatchAgentRun({ ...input(), provider: "", model: undefined, requestId: "default-agent" });
    expect(run.spec.provider).toBe("claude");
  });

  it("returns the run record before Paseo accepts the prompt when the launch sheet defers", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    paseo.startPaseoAgent.mockImplementation(async ({ run, onSubmission }) => {
      await gate;
      onSubmission(`devhub-${run.spec.id}`);
      return { agentId: "agent-1", messageId: `devhub-${run.spec.id}` };
    });
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const started = performance.now();
    const returned = await dispatchAgentRun({ ...input(), requestId: "defer-one" }, { defer: true });
    const returnedMs = performance.now() - started;
    expect(returned.status.state).toBe("starting");
    expect(returned.status.conversationId).toBeUndefined();
    expect(returnedMs).toBeLessThan(500);
    expect(info.mock.calls.some((call) => String(call[0]).includes("deferred"))).toBe(true);
    release();
    await vi.waitFor(() => expect(readAgentRun(returned.spec.id)?.status).toMatchObject({ state: "running", conversationId: "agent-1" }));
    info.mockRestore();
  });

  it("handles a connection failure while worktree creation is pending", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    git.createRunWorktree.mockImplementationOnce(async () => {
      await gate;
      return { cwd: root, baseSha: "abc" };
    });
    paseoClient.openPaseoSession.mockRejectedValueOnce(new Error("Connection refused"));
    const returned = await dispatchAgentRun({ ...input(), worktree: true }, { defer: true });
    // Allow Node's unhandled-rejection turn before the worktree finishes.
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await vi.waitFor(() => expect(readAgentRun(returned.spec.id)?.status).toMatchObject({
      state: "failed", error: "Connection refused",
    }));
    expect(paseo.startPaseoAgent).not.toHaveBeenCalled();
  });

  it("does not ask Paseo to start until the worktree exists", async () => {
    let release!: (value: { worktree: { path: string; branch: string; repoRoot: string }; baseSha: string; cwd: string }) => void;
    git.createRunWorktree.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const returned = await dispatchAgentRun({ ...input(), requestId: "defer-wt", worktree: true }, { defer: true });
    expect(returned.status.state).toBe("starting");
    expect(readAgentRun(returned.spec.id)?.status.startupPhase).toBe("worktree");
    expect(paseo.startPaseoAgent).not.toHaveBeenCalled();
    release({ worktree: { path: `${root}/wt`, branch: "devhub/agent/x", repoRoot: root }, baseSha: "abc", cwd: `${root}/wt` });
    await vi.waitFor(() => expect(paseo.startPaseoAgent).toHaveBeenCalled());
  });
});
